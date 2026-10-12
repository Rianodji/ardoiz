import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendProblem } from "../../../platform/http/problems.js";
import type { Actor } from "../../application/Actor.js";
import type { AuthService } from "../../application/AuthService.js";
import { ABSOLUTE_LIFETIME_MS } from "../../application/sessionRules.js";

/**
 * Niveau d'accès d'une route (configuration Fastify `config.access`) :
 * - `public` : aucune session (connexion, invitation, mot de passe oublié, textes juridiques) ;
 * - `mfa-pending` : session dont le code TOTP est encore attendu (vérification, déconnexion) ;
 * - `enrollment` : session complète, permise au tuteur qui n'a pas encore activé le TOTP ;
 * - `business` (par défaut) : session complète ET, pour le tuteur, TOTP activé (R7).
 */
export type Access = "public" | "mfa-pending" | "enrollment" | "business";

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    actor?: Actor;
  }
}

/** Cookie de session : `__Host-` impose Secure, Path=/ et aucun domaine (ADR-0006, R8). */
export const SESSION_COOKIE = "__Host-ardoiz_session";

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: Math.floor(ABSOLUTE_LIFETIME_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
}

export function sessionTokenOf(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

/** L'acteur posé par le hook d'authentification ; son absence est une erreur de programmation (R18). */
export function actorOf(request: FastifyRequest): Actor {
  if (request.actor === undefined)
    throw new Error("Acteur absent : la route n'est pas protégée par l'authentification.");
  return request.actor;
}

/**
 * Authentification à chaque requête d'API, avant la lecture du corps : cookie → session → acteur.
 * L'acteur vient TOUJOURS de la session (règle 2). Refus par défaut : une route sans niveau d'accès
 * déclaré est une route métier (R18), donc exige une session complète et, pour le tuteur, le TOTP (R7).
 */
export async function registerAuthentication(app: FastifyInstance, auth: AuthService): Promise<void> {
  await app.register(cookie, { hook: "onRequest" });

  app.addHook("onRequest", async (request, reply) => {
    if (reply.sent || !request.url.startsWith("/api/")) return;
    const access: Access = request.routeOptions.config.access ?? "business";
    if (access === "public") return;

    const token = sessionTokenOf(request);
    const resolved = token === undefined ? null : await auth.resolve(token);
    if (resolved === null) {
      if (token !== undefined) clearSessionCookie(reply);
      return sendProblem(request, reply, 401, "http.unauthenticated");
    }
    if (resolved.session.mfaPending && access !== "mfa-pending") {
      return sendProblem(request, reply, 401, "identity.mfa-required");
    }
    const { actor } = resolved;
    // Le tuteur sans TOTP n'a accès qu'à l'enrôlement, à son profil et à la déconnexion (R7, M8).
    if (access === "business" && actor.kind === "tutor" && !actor.mfaEnrolled) {
      return sendProblem(request, reply, 403, "identity.mfa-enrollment-required");
    }
    request.actor = actor;
  });
}
