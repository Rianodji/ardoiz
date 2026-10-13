import type { FastifyInstance } from "fastify";
import type { MetricsRegistry } from "./Metrics.js";

/** Codes d'erreur comptés comme échecs de connexion (tableau de bord, verdict L6 §5). */
const LOGIN_FAILURES: Readonly<Record<string, string>> = {
  "identity.invalid-credentials": "password",
  "identity.invalid-totp": "second-factor",
};

const statusClass = (status: number) => `${String(Math.floor(status / 100))}xx`;

/**
 * Mesures HTTP : la route est le MOTIF déclaré (`/api/learners/:learnerId/progress`), jamais l'URL
 * réelle ; une URL inconnue compte comme « unmatched ». Ainsi le nombre de séries reste borné.
 */
export function registerHttpMetrics(app: FastifyInstance, metrics: MetricsRegistry): void {
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    const status = statusClass(reply.statusCode);
    metrics.httpRequests.inc({ method: request.method, route, status });
    metrics.httpDuration.observe(reply.elapsedTime / 1000, { method: request.method, status });
  });
  app.addHook("onError", async (_request, _reply, error) => {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    const reason = LOGIN_FAILURES[code];
    if (reason !== undefined) metrics.loginFailures.inc({ reason });
  });
}
