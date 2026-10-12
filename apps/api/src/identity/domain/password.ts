import { WeakPasswordError } from "./errors.js";

export type PasswordOwner = "adult" | "learner";

/** Longueurs minimales de R8 : 12 caractères pour un adulte, 8 pour un élève. */
export const MIN_PASSWORD_LENGTH: Readonly<Record<PasswordOwner, number>> = { adult: 12, learner: 8 };
/** Borne haute : argon2 sur une entrée géante serait un déni de service bon marché (M14). */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Politique de mot de passe (R8, M9). Le domaine reçoit la liste des mots de passe courants
 * en paramètre : il ne lit aucun fichier lui-même.
 */
export function checkPassword(
  candidate: string,
  owner: PasswordOwner,
  commonPasswords: ReadonlySet<string>,
  identifiers: readonly string[],
): void {
  // Longueur en graphèmes : un emoji composé compte pour un caractère, comme l'utilisateur le perçoit.
  const length = [...new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(candidate)].length;
  if (length < MIN_PASSWORD_LENGTH[owner]) throw new WeakPasswordError("too-short");
  if (length > MAX_PASSWORD_LENGTH) throw new WeakPasswordError("too-long");
  const lowered = candidate.toLowerCase();
  if (commonPasswords.has(lowered)) throw new WeakPasswordError("common");
  for (const identifier of identifiers) {
    const local = identifier.toLowerCase().split("@")[0] ?? "";
    if (local.length >= 3 && lowered.includes(local)) throw new WeakPasswordError("contains-identifier");
  }
}
