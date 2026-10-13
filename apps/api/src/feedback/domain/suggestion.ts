import { DomainError } from "../../shared-kernel/DomainError.js";

export class InvalidSuggestionInput extends DomainError {
  constructor(readonly code: `feedback.invalid-${string}`) {
    super(`Saisie invalide (${code}).`);
  }
}

/** Trop de suggestions d'un même parent (R15) : 429 avec Retry-After. */
export class TooManySuggestionsError extends DomainError {
  readonly code = "http.too-many-requests";

  constructor(readonly retryAfterSeconds: number) {
    super("Trop de suggestions envoyées.");
  }
}

export const CATEGORIES = ["lessons", "sessions", "assessments", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const STATUSES = ["new", "read", "done"] as const;
export type SuggestionStatus = (typeof STATUSES)[number];

/** Au plus 5 suggestions par parent sur 24 heures glissantes (R15). */
export const DAILY_LIMIT = 5;
export const WINDOW_MS = 24 * 3_600_000;

function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a) continue;
    if (
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

/** Texte brut borné (R4, R15) : affiché comme du texte, jamais comme du HTML. */
export function plainText(raw: unknown, max: number, code: `feedback.invalid-${string}`): string {
  if (typeof raw !== "string") throw new InvalidSuggestionInput(code);
  const value = raw.normalize("NFC").replace(/\r\n/g, "\n").trim();
  if (value.length === 0 || value.length > max || hasForbiddenCharacter(value))
    throw new InvalidSuggestionInput(code);
  return value;
}

/**
 * Débit (R15, M14) : au vu des envois des dernières 24 h, l'envoi est permis, ou il faut attendre
 * que le plus ancien sorte de la fenêtre.
 */
export function retryAfterSeconds(recent: readonly Date[], now: Date): number | null {
  const inWindow = recent
    .filter((at) => at.getTime() > now.getTime() - WINDOW_MS)
    .sort((a, b) => a.getTime() - b.getTime());
  if (inWindow.length < DAILY_LIMIT) return null;
  const oldest = inWindow[inWindow.length - DAILY_LIMIT] ?? now;
  return Math.max(1, Math.ceil((oldest.getTime() + WINDOW_MS - now.getTime()) / 1000));
}
