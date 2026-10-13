import { createServer, type Server } from "node:http";
import type { Pool } from "pg";
import type { MetricsRegistry } from "./Metrics.js";

/**
 * Serveur de métriques sur un PORT SÉPARÉ (9464 par défaut), jamais routé par Traefik : seul le
 * Prometheus du réseau `infra` le lit (ADR-0008 amendée). Le port 3000 répond 404 sur /metrics.
 * Une seule route, en lecture : GET /metrics. Tout le reste répond 404, sans corps.
 */
export function startMetricsServer(metrics: MetricsRegistry, host: string, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    void metrics.render().then(
      (body) => {
        response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" }).end(body);
      },
      () => {
        response.writeHead(500).end();
      },
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}

/**
 * Jauges de la messagerie, tous espaces confondus, par la fonction étroite `messaging.health_snapshot`
 * (migration 011) : des nombres seulement.
 */
export function messagingGauges(pool: Pool, metrics: MetricsRegistry): void {
  let cached: { at: number; value: Promise<{ age: number; dead: number; retrying: number }> } | null = null;
  const snapshot = () => {
    // Une seule requête par collecte, partagée par les trois jauges.
    if (cached === null || Date.now() - cached.at > 1_000) {
      cached = {
        at: Date.now(),
        value: pool
          .query<{ oldest_pending_seconds: number; dead_events: string; retrying_events: string }>(
            "SELECT oldest_pending_seconds, dead_events, retrying_events FROM messaging.health_snapshot()",
          )
          .then(({ rows }) => ({
            age: rows[0]?.oldest_pending_seconds ?? 0,
            dead: Number(rows[0]?.dead_events ?? 0),
            retrying: Number(rows[0]?.retrying_events ?? 0),
          })),
      };
    }
    return cached.value;
  };
  metrics.addGauge({
    name: "ardoiz_outbox_oldest_pending_seconds",
    help: "Âge de l'événement le plus ancien en attente dans l'outbox.",
    read: async () => (await snapshot()).age,
  });
  metrics.addGauge({
    name: "ardoiz_failed_events_dead",
    help: "Événements abandonnés (lettres mortes) non résolus, tous consommateurs.",
    read: async () => (await snapshot()).dead,
  });
  metrics.addGauge({
    name: "ardoiz_failed_events_retrying",
    help: "Événements en échec en attente d'un nouvel essai.",
    read: async () => (await snapshot()).retrying,
  });
}
