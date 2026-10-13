/** Une règle de débit : au plus `limit` actions sur `windowMs`. */
export interface RateRule {
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Limiteur en mémoire à fenêtres glissantes (une seule instance tourne, HANDOFF_INFRA.md). Chaque
 * clé garde les instants de ses actions acceptées ; une action refusée n'est pas comptée. Les clés ne
 * sont ni écrites sur disque ni journalisées.
 */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();

  constructor(private readonly rules: readonly RateRule[]) {}

  /** Accepte et compte l'action, ou renvoie le nombre de secondes à attendre. */
  take(key: string, now: Date): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const at = now.getTime();
    const longest = Math.max(...this.rules.map((rule) => rule.windowMs));
    const recent = (this.#hits.get(key) ?? []).filter((hit) => hit > at - longest);
    let wait = 0;
    for (const rule of this.rules) {
      const inWindow = recent.filter((hit) => hit > at - rule.windowMs);
      if (inWindow.length >= rule.limit) {
        // La plus ancienne action de la fenêtre doit en sortir pour libérer une place.
        const oldest = inWindow[inWindow.length - rule.limit] ?? at;
        wait = Math.max(wait, oldest + rule.windowMs - at);
      }
    }
    if (wait > 0) {
      this.#hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }
    recent.push(at);
    this.#hits.set(key, recent);
    if (this.#hits.size > 100_000) this.#prune(at - longest);
    return { allowed: true };
  }

  #prune(since: number): void {
    for (const [key, hits] of this.#hits) if (hits.every((hit) => hit <= since)) this.#hits.delete(key);
  }
}
