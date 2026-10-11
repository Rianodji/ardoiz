import { HealthStatus } from "@ardoiz/contracts";
import type { FastifyInstance } from "fastify";

/** Sonde de disponibilité : vrai si les dépendances indispensables répondent. */
export type ReadinessProbe = () => Promise<boolean>;

/**
 * `/healthz` : le processus répond. `/readyz` : la base répond.
 * Une sonde qui échoue ou qui lève une erreur rend le service « indisponible » (R18) ;
 * la réponse ne dit jamais pourquoi, seul le journal le dit.
 */
export function registerHealthRoutes(app: FastifyInstance, ready: ReadinessProbe): void {
  const schema = { response: { 200: HealthStatus, 503: HealthStatus } };

  app.get("/healthz", { schema, logLevel: "warn" }, (_request, reply) => reply.send({ status: "ok" }));

  app.get("/readyz", { schema, logLevel: "warn" }, async (request, reply) => {
    let isReady = false;
    try {
      isReady = await ready();
    } catch (error) {
      request.log.error({ err: error }, "sonde de disponibilité en échec");
    }
    return reply.code(isReady ? 200 : 503).send({ status: isReady ? "ok" : "unavailable" });
  });
}
