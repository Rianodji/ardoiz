/**
 * Série hebdomadaire (big picture §8, ADR-0009, R17). Une semaine compte si l'élève a terminé un cours,
 * rendu une copie ou participé à une séance. Semaines du lundi au dimanche, EN HEURE DE PARIS. Une
 * semaine sans activité met la série en pause, sans la remettre à zéro, UNE FOIS PAR MOIS ; une
 * deuxième semaine vide dans le même mois la remet à zéro. La semaine en cours n'est jamais une
 * semaine manquée : elle n'est pas finie.
 */
export interface StreakState {
  /** Semaines actives de la série en cours. */
  readonly current: number;
  /** Meilleure série atteinte. */
  readonly best: number;
  /** La dernière semaine terminée était vide, et la pause du mois l'a couverte. */
  readonly paused: boolean;
}

const addWeeks = (monday: string, weeks: number): string => {
  const [y = 0, m = 1, d = 1] = monday.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + weeks * 7)).toISOString().slice(0, 10);
};

/** Lundi (date locale de Paris) de la semaine d'un jour local `AAAA-MM-JJ`. */
export function mondayOf(localDate: string): string {
  const [y = 0, m = 1, d = 1] = localDate.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const shift = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(y, m - 1, d - shift)).toISOString().slice(0, 10);
}

/** Date locale de Paris d'un instant (calcul pur, par la base de fuseaux du moteur). */
export function parisDate(instant: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(instant);
}

export function streakOf(activeWeeks: ReadonlySet<string>, currentWeek: string): StreakState {
  const weeks = [...activeWeeks].filter((week) => week <= currentWeek).sort();
  const first = weeks[0];
  if (first === undefined) return { current: 0, best: 0, paused: false };
  let current = 0;
  let best = 0;
  let paused = false;
  const pausesUsed = new Set<string>();
  for (let week = first; week <= currentWeek; week = addWeeks(week, 1)) {
    if (activeWeeks.has(week)) {
      current++;
      best = Math.max(best, current);
      paused = false;
      continue;
    }
    if (week === currentWeek) break; // la semaine en cours n'est pas finie
    // Le mois d'une semaine est celui de son lundi.
    const month = week.slice(0, 7);
    if (current > 0 && !pausesUsed.has(month)) {
      pausesUsed.add(month);
      paused = true;
    } else {
      current = 0;
      paused = false;
    }
  }
  return { current, best, paused };
}
