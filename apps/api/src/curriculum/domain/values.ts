import { InvalidCurriculumInput } from "./errors.js";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Title = Brand<string, "Title">;
export type CompetencyLabel = Brand<string, "CompetencyLabel">;
export type GroupName = Brand<string, "GroupName">;

/** Caractères de contrôle et marques bidirectionnelles : refusés (R4). */
function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    )
      return true;
  }
  return false;
}

function boundedText(raw: unknown, max: number, code: `curriculum.invalid-${string}`): string {
  if (typeof raw !== "string") throw new InvalidCurriculumInput(code);
  const value = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (value.length === 0 || value.length > max || hasForbiddenCharacter(value))
    throw new InvalidCurriculumInput(code);
  return value;
}

/** Titre d'un module ou d'un cours : texte simple, rendu comme du texte (R4). */
export function Title(raw: unknown): Title {
  return boundedText(raw, 120, "curriculum.invalid-title") as Title;
}

export function CompetencyLabel(raw: unknown): CompetencyLabel {
  return boundedText(raw, 200, "curriculum.invalid-competency-label") as CompetencyLabel;
}

export function GroupName(raw: unknown): GroupName {
  return boundedText(raw, 60, "curriculum.invalid-group-name") as GroupName;
}

/** Position dans une liste ordonnée. */
export function Position(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 10_000) {
    throw new InvalidCurriculumInput("curriculum.invalid-position");
  }
  return raw;
}
