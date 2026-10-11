import fastifyStatic from "@fastify/static";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { DestinationStream } from "pino";
import type { AppConfig } from "../platform/config/loadConfig.js";
import { registerHardening } from "../platform/http/hardening.js";
import { registerHealthRoutes, type ReadinessProbe } from "../platform/http/health.js";
import { registerProblemHandlers, sendProblem } from "../platform/http/problems.js";
import { loggerOptions } from "../platform/logging/logger.js";

export type ServerConfig = Pick<AppConfig, "publicOrigin" | "logLevel" | "webDistDir" | "trustedProxies">;

export interface ServerDependencies {
  readonly config: ServerConfig;
  readonly readiness: ReadinessProbe;
  /** Destination des journaux ; la sortie standard par défaut (collectée par Alloy). */
  readonly logStream?: DestinationStream;
}

/** Corps JSON limité à 1 Mio par défaut (R15, M14) ; les routes du cahier relèveront leur limite au lot L4. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

/**
 * Racine de composition HTTP : le seul endroit qui assemble Fastify, les adaptateurs et les modules.
 * L'ordre compte : durcissement et erreurs d'abord, routes ensuite.
 */
export async function buildServer(deps: ServerDependencies): Promise<FastifyInstance> {
  // Seul Traefik est devant l'application (ADR-0008) : X-Forwarded-For n'est cru que s'il vient
  // d'une adresse de confiance, sinon un client choisirait son adresse et échapperait à la limitation
  // de débit (R8). Un simple nombre de sauts ne vérifie pas le pair : Fastify le refuse, et nous aussi.
  const trustProxy = deps.config.trustedProxies.length > 0 ? [...deps.config.trustedProxies] : false;
  const app = Fastify({
    bodyLimit: DEFAULT_BODY_LIMIT,
    // Identifiant de requête généré par le serveur : un client ne choisit pas l'identifiant de corrélation.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: "requestId" }),
    trustProxy,
    return503OnClosing: true,
    // Validation stricte (règle 5) : aucun champ supplémentaire retiré en silence, aucune coercition.
    ajv: {
      customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: false },
    },
    logger: deps.logStream
      ? { ...loggerOptions(deps.config.logLevel), stream: deps.logStream }
      : loggerOptions(deps.config.logLevel),
  });

  // JSON uniquement (R11) : tout autre type de contenu est refusé (415).
  app.removeContentTypeParser(["text/plain"]);

  registerProblemHandlers(app);
  await registerHardening(app, deps.config.publicOrigin);
  registerHealthRoutes(app, deps.readiness);

  const webDistDir = deps.config.webDistDir;
  if (webDistDir !== undefined) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      wildcard: false,
      index: false,
      dotfiles: "deny",
      // Fichiers à empreinte (Vite) : ils peuvent être mis en cache ; index.html, jamais.
      setHeaders: (reply, path) => {
        if (path.includes("/assets/")) reply.header("cache-control", "public, max-age=31536000, immutable");
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    // Navigation de la SPA : toute URL hors API renvoie index.html, le routeur du front décide.
    const isNavigation = request.method === "GET" && !request.url.startsWith("/api/");
    if (webDistDir !== undefined && isNavigation) return reply.type("text/html").sendFile("index.html");
    return sendProblem(request, reply, 404, "application.not-found");
  });

  return app;
}
