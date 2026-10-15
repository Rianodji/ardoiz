/**
 * Dates et nombres écrits en clair, en heure de Paris (charte §7, H8) : « jeudi 16 octobre à 18 h ».
 * Une échéance est toujours écrite, jamais un compte à rebours qui défile.
 */
const ZONE = "Europe/Paris";

const partsOf = (iso: string | number | Date, options: Intl.DateTimeFormatOptions) => {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: ZONE, ...options }).formatToParts(new Date(iso));
  return (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
};

/**
 * Espace insécable : une heure ne se coupe jamais en fin de ligne, ni de son « à »
 * (verdict L8, S-1 : « jeudi 15 octobre à 2 h / 55 » se coupait en deux lignes).
 */
export const NBSP = "\u00a0";

/** Un seul format d'heure partout (charte §7, verdict L8 S-2) : « 18 h », « 2 h 55 ». */
function clockFr(hour: number, minute: number): string {
  return minute === 0
    ? `${String(hour)}${NBSP}h`
    : `${String(hour)}${NBSP}h${NBSP}${String(minute).padStart(2, "0")}`;
}

/** « 18 h » ou « 18 h 30 », en heure de Paris. */
export function hourFr(iso: string | number | Date): string {
  const part = partsOf(iso, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  return clockFr(Number(part("hour")), Number(part("minute")));
}

/** Une heure locale « 14:05 » (agenda, déjà en heure de Paris) écrite « 14 h 05 ». */
export function localHourFr(time: string): string {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return clockFr(hour, minute);
}

/** « jeudi 16 octobre ». */
export function longDate(iso: string | number | Date): string {
  const part = partsOf(iso, { weekday: "long", day: "numeric", month: "long" });
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** « jeudi 16 octobre à 18 h ». */
export function longDateTime(iso: string | number | Date): string {
  return `${longDate(iso)} à${NBSP}${hourFr(iso)}`;
}

/** « jeudi 18 h » : échéance proche, dans la semaine. */
export function weekdayHour(iso: string | number | Date): string {
  return `${partsOf(iso, { weekday: "long" })("weekday")}${NBSP}${hourFr(iso)}`;
}

/** « 16 oct. ». */
export function shortDate(iso: string | number | Date): string {
  const part = partsOf(iso, { day: "numeric", month: "short" });
  return `${part("day")} ${part("month")}`;
}

/** « 16 oct. à 18 h 12 » (journal d'audit, appareils, file de correction). */
export function shortDateTime(iso: string | number | Date): string {
  return `${shortDate(iso)} à${NBSP}${hourFr(iso)}`;
}

/** « Mardi 14 octobre » : la date du jour, en tête d'un accueil. */
export function todayTitle(now: number): string {
  const text = longDate(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Note ou moyenne : « 15,5 ». */
export function numberFr(value: number): string {
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** « 1 copie », « 2 copies ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${String(count)} ${count > 1 ? pluralForm : singular}`;
}
