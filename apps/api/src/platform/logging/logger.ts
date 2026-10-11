import type { FastifyRequest } from "fastify";
import { stdTimeFunctions, type LoggerOptions } from "pino";

/**
 * Champs qui ne doivent jamais atteindre un journal (R21, M19) : secrets d'authentification,
 * et contenu produit par les élèves (réponses, scènes du cahier).
 */
export const SENSITIVE_KEYS = [
  "password",
  "email",
  "newPassword",
  "currentPassword",
  "token",
  "totp",
  "totpCode",
  "totpSecret",
  "recoveryCode",
  "secret",
  "cookie",
  "set-cookie",
  "authorization",
  "apiKey",
  "api-key",
  "answers",
  "answer",
  "scene",
] as const;

/** Profondeur couverte : pino ne connaît que le joker d'un niveau (`*.password`). */
const MAX_DEPTH = 4;

function redactionPaths(): string[] {
  const paths: string[] = [];
  for (const key of SENSITIVE_KEYS) {
    const segment = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      const prefix = "*.".repeat(depth);
      paths.push(segment.startsWith("[") ? `${prefix.slice(0, -1)}${segment}` : `${prefix}${segment}`);
    }
  }
  // Un chemin commençant par « [ » n'est valide qu'après un parent : on retire la forme racine.
  return paths.filter((path) => !path.startsWith("["));
}

export const REDACTED = "[masqué]";

/**
 * Sérialiseur d'erreur à liste blanche (R21, réserve R-2). Le sérialiseur standard de pino copie
 * toutes les propriétés énumérables : une erreur `pg` y ajouterait `detail`
 * (« Key (email)=(awa@example.org) already exists. »), `where`, `table`… On ne garde que
 * le type, le message, la pile, le code SQLSTATE et le nom de la contrainte.
 */
export function serializeError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { type: typeof error };
  const safe: Record<string, string> = { type: error.name, message: error.message };
  if (error.stack !== undefined) safe["stack"] = error.stack;
  if ("code" in error && typeof error.code === "string") safe["code"] = error.code;
  if ("constraint" in error && typeof error.constraint === "string") safe["constraint"] = error.constraint;
  return safe;
}

/**
 * Le chemin seul, sans la chaîne de requête : un jeton d'invitation ou de réinitialisation
 * passé dans l'URL ne doit pas finir dans les journaux (R21).
 */
function pathOnly(url: string): string {
  const index = url.indexOf("?");
  return index === -1 ? url : `${url.slice(0, index)}?[masqué]`;
}

/**
 * Configuration pino : JSON structuré sur la sortie standard (collecté par Alloy vers Loki),
 * identifiant de requête sur chaque ligne, redaction des champs sensibles (R21).
 * L'adresse IP n'est pas journalisée (minimisation, données de mineurs).
 */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { service: "ardoiz-api" },
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: redactionPaths(), censor: REDACTED },
    serializers: {
      req: (request: FastifyRequest) => ({ method: request.method, url: pathOnly(request.url) }),
      err: serializeError,
    },
  };
}
