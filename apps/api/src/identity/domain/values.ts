import { InvalidIdentityInput } from "./errors.js";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EmailAddress = Brand<string, "EmailAddress">;
export type Username = Brand<string, "Username">;
export type SpaceCode = Brand<string, "SpaceCode">;
export type FirstName = Brand<string, "FirstName">;
export type DisplayName = Brand<string, "DisplayName">;

const EMAIL =
  /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Adresse e-mail d'un adulte, normalisée en minuscules (R9 cadrage : strict nécessaire). */
export function EmailAddress(raw: unknown): EmailAddress {
  if (typeof raw !== "string") throw new InvalidIdentityInput("identity.invalid-email");
  const value = raw.trim().toLowerCase();
  if (value.length > 254 || !EMAIL.test(value)) throw new InvalidIdentityInput("identity.invalid-email");
  return value as EmailAddress;
}

/**
 * Pseudo de connexion d'un élève, unique dans l'espace (ADR-0003), libre et non dérivé
 * de l'identité réelle (cadrage §5). Lettres minuscules non accentuées, chiffres, point, tiret, souligné.
 */
export function Username(raw: unknown): Username {
  if (typeof raw !== "string") throw new InvalidIdentityInput("identity.invalid-username");
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/.test(value))
    throw new InvalidIdentityInput("identity.invalid-username");
  return value as Username;
}

/** Code d'espace, court et non secret, saisi par l'élève à la connexion (ADR-0003). */
export function SpaceCode(raw: unknown): SpaceCode {
  if (typeof raw !== "string") throw new InvalidIdentityInput("identity.invalid-space-code");
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(value))
    throw new InvalidIdentityInput("identity.invalid-space-code");
  return value as SpaceCode;
}

const PERSON_NAME = /^\p{L}[\p{L}\p{M}' -]*$/u;

function personName(raw: unknown, max: number, code: `identity.invalid-${string}`): string {
  if (typeof raw !== "string") throw new InvalidIdentityInput(code);
  const value = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (value.length === 0 || value.length > max || !PERSON_NAME.test(value))
    throw new InvalidIdentityInput(code);
  return value;
}

/** Prénom seul de l'élève : pas de nom de famille (minimisation, cadrage §5). */
export function FirstName(raw: unknown): FirstName {
  return personName(raw, 50, "identity.invalid-first-name") as FirstName;
}

/** Nom affiché d'un adulte (parent ou tuteur). */
export function DisplayName(raw: unknown): DisplayName {
  return personName(raw, 100, "identity.invalid-display-name") as DisplayName;
}

// QUESTION Q9 : le cadrage cite « 6e, 5e… » (collège). Les niveaux du primaire (CM1, CM2) ne sont
// pas ouverts tant que le PO ne l'a pas décidé : option la plus restrictive.
export const SCHOOL_LEVELS = ["6e", "5e", "4e", "3e"] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

/** Niveau scolaire, à la place de toute date de naissance (R16, cadrage §5). */
export function SchoolLevel(raw: unknown): SchoolLevel {
  const found = SCHOOL_LEVELS.find((level) => level === raw);
  if (found === undefined) throw new InvalidIdentityInput("identity.invalid-school-level");
  return found;
}
