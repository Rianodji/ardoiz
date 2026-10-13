import { InvalidSchedulingInput, SchedulingConflictError } from "./errors.js";
import { addDays, localToUtc, parseLocalDate, parseLocalTime } from "./localTime.js";

/**
 * Règle d'une séance (H8) : ponctuelle, ou hebdomadaire jusqu'à une date de fin, EN HEURE LOCALE.
 * Une séance hebdomadaire à 14 h reste à 14 h à Paris après un changement d'heure : chaque occurrence
 * est convertie en UTC pour sa propre date.
 */
export type Recurrence =
  | { readonly kind: "once"; readonly date: string; readonly time: string; readonly durationMinutes: number }
  | {
      readonly kind: "weekly";
      readonly date: string;
      readonly time: string;
      readonly durationMinutes: number;
      readonly until: string;
    };

export interface Occurrence {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Bornes : une séance dure de 15 min à 4 h ; une série compte au plus 52 semaines. */
export const MIN_DURATION = 15;
export const MAX_DURATION = 240;
export const MAX_WEEKS = 52;

export function parseDuration(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < MIN_DURATION ||
    raw > MAX_DURATION ||
    raw % 5 !== 0
  ) {
    throw new InvalidSchedulingInput("scheduling.invalid-duration");
  }
  return raw;
}

export function parseRecurrence(raw: {
  readonly kind: "once" | "weekly";
  readonly date: unknown;
  readonly time: unknown;
  readonly durationMinutes: unknown;
  readonly until?: unknown;
}): Recurrence {
  const date = parseLocalDate(raw.date);
  const time = parseLocalTime(raw.time);
  const durationMinutes = parseDuration(raw.durationMinutes);
  if (raw.kind === "once") return { kind: "once", date, time, durationMinutes };
  const until = parseLocalDate(raw.until);
  if (until < date || until > addDays(date, 7 * (MAX_WEEKS - 1)))
    throw new InvalidSchedulingInput("scheduling.invalid-until");
  return { kind: "weekly", date, time, durationMinutes, until };
}

export function occurrenceAt(date: string, time: string, durationMinutes: number): Occurrence {
  const startsAt = localToUtc({ date, time });
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) };
}

/** Occurrences d'une règle, chacune convertie en UTC à sa date (changement d'heure compris, H8). */
export function occurrencesOf(rule: Recurrence): Occurrence[] {
  if (rule.kind === "once") return [occurrenceAt(rule.date, rule.time, rule.durationMinutes)];
  const occurrences: Occurrence[] = [];
  for (let date = rule.date; date <= rule.until; date = addDays(date, 7)) {
    occurrences.push(occurrenceAt(date, rule.time, rule.durationMinutes));
  }
  return occurrences;
}

/** On ne planifie ni ne déplace une séance dans le passé, selon l'horloge du serveur. */
export function assertInFuture(occurrence: Occurrence, now: Date): void {
  if (occurrence.startsAt.getTime() <= now.getTime())
    throw new SchedulingConflictError("scheduling.in-the-past");
}

/** Avance du lien sur le début de la séance (R9). */
export const LINK_LEAD_MS = 15 * 60_000;

/**
 * Fenêtre du lien de visio (R9, M10) : de 15 min avant le début (inclus) jusqu'à la fin (exclue),
 * pour une séance qui n'est pas annulée. Toujours selon l'horloge du serveur.
 */
export function linkWindowOpen(occurrence: Occurrence & { readonly cancelled: boolean }, now: Date): boolean {
  if (occurrence.cancelled) return false;
  const at = now.getTime();
  return at >= occurrence.startsAt.getTime() - LINK_LEAD_MS && at < occurrence.endsAt.getTime();
}
