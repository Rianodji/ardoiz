/**
 * Dates et nombres écrits en clair, en heure de Paris (charte §7, H8) : « jeudi 16 octobre à 18 h ».
 * Une échéance est toujours écrite, jamais un compte à rebours qui défile.
 */
const ZONE = "Europe/Paris";

const partsOf = (iso: string | number | Date, options: Intl.DateTimeFormatOptions) => {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: ZONE, ...options }).formatToParts(new Date(iso));
  return (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
};

/** « 18 h » ou « 18 h 30 ». */
export function hourFr(iso: string | number | Date): string {
  const part = partsOf(iso, { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const minute = part("minute");
  return `${String(Number(part("hour")))} h${minute === "00" ? "" : ` ${minute}`}`;
}

/** « jeudi 16 octobre ». */
export function longDate(iso: string | number | Date): string {
  const part = partsOf(iso, { weekday: "long", day: "numeric", month: "long" });
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** « jeudi 16 octobre à 18 h ». */
export function longDateTime(iso: string | number | Date): string {
  return `${longDate(iso)} à ${hourFr(iso)}`;
}

/** « jeudi 18 h » : échéance proche, dans la semaine. */
export function weekdayHour(iso: string | number | Date): string {
  return `${partsOf(iso, { weekday: "long" })("weekday")} ${hourFr(iso)}`;
}

/** « 16 oct. ». */
export function shortDate(iso: string | number | Date): string {
  const part = partsOf(iso, { day: "numeric", month: "short" });
  return `${part("day")} ${part("month")}`;
}

/** « 16 oct. à 18:12 » (journal d'audit, appareils). */
export function shortDateTime(iso: string | number | Date): string {
  const part = partsOf(iso, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${part("day")} ${part("month")} à ${part("hour")}:${part("minute")}`;
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
