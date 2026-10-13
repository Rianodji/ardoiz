/**
 * Registre de métriques au format texte de Prometheus (exposition 0.0.4), écrit à la main : quelques
 * compteurs, un histogramme et des jauges suffisent, sans dépendance de plus (R19).
 * Les étiquettes sont bornées par construction (méthode, classe de statut, motif de route) : jamais
 * d'identifiant, d'adresse ni de donnée d'un utilisateur.
 */
type Labels = Readonly<Record<string, string>>;

const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labelText = (labels: Labels) => {
  const entries = Object.entries(labels);
  return entries.length === 0
    ? ""
    : `{${entries.map(([key, value]) => `${key}="${escape(value)}"`).join(",")}}`;
};
const keyOf = (labels: Labels) =>
  JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));

export class Counter {
  readonly #values = new Map<string, { labels: Labels; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = keyOf(labels);
    const entry = this.#values.get(key) ?? { labels, value: 0 };
    entry.value += by;
    this.#values.set(key, entry);
  }

  render(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...[...this.#values.values()].map(
        (entry) => `${this.name}${labelText(entry.labels)} ${String(entry.value)}`,
      ),
    ];
  }
}

export class Histogram {
  readonly #series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[],
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = keyOf(labels);
    const series = this.#series.get(key) ?? { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.buckets.forEach((bound, index) => {
      if (value <= bound) series.counts[index] = (series.counts[index] ?? 0) + 1;
    });
    series.sum += value;
    series.count += 1;
    this.#series.set(key, series);
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const series of this.#series.values()) {
      this.buckets.forEach((bound, index) => {
        lines.push(
          `${this.name}_bucket${labelText({ ...series.labels, le: String(bound) })} ${String(series.counts[index] ?? 0)}`,
        );
      });
      lines.push(`${this.name}_bucket${labelText({ ...series.labels, le: "+Inf" })} ${String(series.count)}`);
      lines.push(`${this.name}_sum${labelText(series.labels)} ${String(series.sum)}`);
      lines.push(`${this.name}_count${labelText(series.labels)} ${String(series.count)}`);
    }
    return lines;
  }
}

/** Jauge lue au moment de la collecte. */
export interface GaugeSource {
  readonly name: string;
  readonly help: string;
  read(): Promise<number>;
}

export class MetricsRegistry {
  readonly httpRequests = new Counter(
    "ardoiz_http_requests_total",
    "Requêtes HTTP traitées, par méthode, route et classe de statut.",
  );
  readonly httpDuration = new Histogram(
    "ardoiz_http_request_duration_seconds",
    "Durée des requêtes HTTP, par méthode et classe de statut.",
    [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  );
  readonly loginFailures = new Counter(
    "ardoiz_login_failures_total",
    "Échecs de connexion, par motif (mot de passe ou second facteur).",
  );
  readonly #gauges: GaugeSource[] = [];

  addGauge(gauge: GaugeSource): void {
    this.#gauges.push(gauge);
  }

  async render(): Promise<string> {
    const lines = [
      ...this.httpRequests.render(),
      ...this.httpDuration.render(),
      ...this.loginFailures.render(),
    ];
    for (const gauge of this.#gauges) {
      let value = Number.NaN;
      try {
        value = await gauge.read();
      } catch {
        // Une jauge illisible (base indisponible) vaut NaN : l'alerte voit l'absence de valeur.
      }
      lines.push(
        `# HELP ${gauge.name} ${gauge.help}`,
        `# TYPE ${gauge.name} gauge`,
        `${gauge.name} ${String(value)}`,
      );
    }
    const memory = process.memoryUsage();
    lines.push(
      "# HELP process_resident_memory_bytes Mémoire résidente du processus.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${String(memory.rss)}`,
      "# HELP nodejs_heap_used_bytes Tas JavaScript utilisé.",
      "# TYPE nodejs_heap_used_bytes gauge",
      `nodejs_heap_used_bytes ${String(memory.heapUsed)}`,
      "# HELP process_uptime_seconds Durée depuis le démarrage du processus.",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${String(process.uptime())}`,
    );
    return `${lines.join("\n")}\n`;
  }
}
