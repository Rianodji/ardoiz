import { InvalidSchedulingInput } from "./errors.js";

/**
 * Heure locale de l'espace (H8) : les séances se pensent en heure de Paris, se stockent en UTC.
 * Conversions pures, par `Intl` (base de fuseaux du moteur JavaScript), sans horloge ni E/S.
 */
export const SPACE_TIME_ZONE = "Europe/Paris";

/** Date locale `AAAA-MM-JJ` et heure locale `HH:MM`. */
export interface LocalDateTime {
  readonly date: string;
  readonly time: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseLocalDate(raw: unknown): string {
  const match = typeof raw === "string" ? DATE.exec(raw) : null;
  if (match === null) throw new InvalidSchedulingInput("scheduling.invalid-date");
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new InvalidSchedulingInput("scheduling.invalid-date");
  }
  return raw as string;
}

export function parseLocalTime(raw: unknown): string {
  if (typeof raw !== "string" || !TIME.test(raw)) throw new InvalidSchedulingInput("scheduling.invalid-time");
  return raw;
}

/** Date locale décalée de `days` jours (calendrier civil, sans fuseau). */
export function addDays(date: string, days: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Écart (minutes) entre l'heure locale du fuseau et UTC, à un instant donné. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Instant UTC d'une heure locale de Paris (heure d'été comme d'hiver). Autour d'un changement d'heure :
 * - heure ambiguë (passage à l'heure d'hiver, 2 h – 3 h vécues deux fois) : la PREMIÈRE, en heure d'été ;
 * - heure inexistante (passage à l'heure d'été, 2 h – 3 h sautées) : l'heure qui suit le saut.
 */
export function localToUtc({ date, time }: LocalDateTime, timeZone = SPACE_TIME_ZONE): Date {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMinutes(new Date(wall - 3 * 3_600_000), timeZone);
  const after = offsetMinutes(new Date(wall + 3 * 3_600_000), timeZone);
  const matches = [...new Set([before, after])]
    .map((offset) => new Date(wall - offset * 60_000))
    .filter((candidate) => {
      const local = utcToLocal(candidate, timeZone);
      return local.date === date && local.time === time;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  return matches[0] ?? new Date(wall - before * 60_000);
}

/** Heure locale de Paris d'un instant UTC. */
export function utcToLocal(instant: Date, timeZone = SPACE_TIME_ZONE): LocalDateTime {
  const local = new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60_000);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
}
