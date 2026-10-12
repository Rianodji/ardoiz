import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";
import { sendProblem } from "./problems.js";

/**
 * Politique de sécurité du contenu (R11, M4, M15) : tout vient de notre origine ; aucun script
 * en ligne ni `eval` ; la seule intégration tierce autorisée est le lecteur YouTube sans cookie,
 * chargé après un clic (R13) ; la page ne peut être intégrée nulle part (clickjacking).
 */
export const CONTENT_SECURITY_POLICY = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  // `data:` pour les images seulement (ADR-0012 proposée) : icônes et curseurs SVG générés par Excalidraw.
  // Une image ne peut exécuter aucun script ; scripts, styles et polices restent limités à notre origine.
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "media-src": ["'self'"],
  "frame-src": ["https://www.youtube-nocookie.com"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "upgrade-insecure-requests": [],
} as const;

/** Aucune API matérielle n'est utile à Ardoiz : tout est refusé, sauf le plein écran de notre origine. */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "browsing-topics=()",
  "fullscreen=(self)",
].join(", ");

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Durcissement HTTP (R11) :
 * - en-têtes de sécurité sur toutes les réponses, y compris la SPA et les erreurs ;
 * - aucune réponse CORS : la SPA et l'API partagent la même origine (ADR-0006) ;
 * - toute requête modifiante doit venir de notre origine (en-tête `Origin`), en complément de SameSite (M15) ;
 * - aucune donnée de l'API dans un cache.
 */
export async function registerHardening(app: FastifyInstance, publicOrigin: string): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: { useDefaults: false, directives: CONTENT_SECURITY_POLICY },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: "same-origin" },
    frameguard: { action: "deny" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    // COEP « require-corp » empêcherait le lecteur YouTube (R13) : volontairement non activé.
    crossOriginEmbedderPolicy: false,
    xDnsPrefetchControl: { allow: false },
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
  });

  app.addHook("onRequest", async (request, reply) => {
    // Défense CSRF (R11, M15) : une écriture sans Origin, ou depuis une autre origine, est refusée
    // avant toute lecture du corps et avant toute authentification.
    if (UNSAFE_METHODS.has(request.method) && request.headers.origin !== publicOrigin) {
      request.log.warn({ code: "http.origin-rejected" }, "origine refusée");
      return sendProblem(request, reply, 403, "http.origin-rejected");
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("permissions-policy", PERMISSIONS_POLICY);
    // Les réponses de l'API contiennent des données de mineurs : jamais en cache (navigateur ou proxy).
    if (!request.url.startsWith("/assets/")) reply.header("cache-control", "no-store");
    return payload;
  });
}
