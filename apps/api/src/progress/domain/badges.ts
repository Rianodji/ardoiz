import { isAcquired, levelHistory, type Evidence, type MasteryLevel } from "./mastery.js";

/** Badges du J1 (big picture §8, ADR-0009) : un catalogue fixe, sans récompense aléatoire. */
export const BADGES = ["first-step", "geometer", "units-master", "assiduous", "persevering"] as const;
export type Badge = (typeof BADGES)[number];

export interface BadgeFacts {
  /** Au moins une copie rendue. */
  readonly submittedCopies: number;
  /** Niveaux actuels, par code de compétence (GEO-01…). */
  readonly levelsByCode: ReadonlyMap<string, MasteryLevel>;
  /** Exercices de conversion corrigés, dans l'ordre de publication : réussi ou non. */
  readonly conversions: readonly boolean[];
  /** Meilleure série hebdomadaire. */
  readonly bestStreak: number;
  /** Preuves par compétence, pour « Persévérant ». */
  readonly evidencesByCompetency: ReadonlyMap<string, readonly Evidence[]>;
}

const GEOMETRY_PREFIX = "GEO-";

/** Plus longue suite de réussites consécutives. */
function longestRun(results: readonly boolean[]): number {
  let run = 0;
  let longest = 0;
  for (const success of results) {
    run = success ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * Badges mérités au vu des faits. Un badge obtenu n'est jamais retiré (R17) : l'application ne fait
 * qu'AJOUTER les badges qui manquent.
 * - Premier pas : première copie rendue ;
 * - Géomètre : 5 compétences de géométrie (GEO-…) acquises ;
 * - Maître des unités : 10 conversions réussies d'affilée ;
 * - Assidu : série de 4 semaines ;
 * - Persévérant : une compétence passée de « non acquis » à « acquis ».
 */
export function earnedBadges(facts: BadgeFacts): Badge[] {
  const badges: Badge[] = [];
  if (facts.submittedCopies > 0) badges.push("first-step");
  const geometryAcquired = [...facts.levelsByCode].filter(
    ([code, level]) => code.startsWith(GEOMETRY_PREFIX) && isAcquired(level),
  ).length;
  if (geometryAcquired >= 5) badges.push("geometer");
  if (longestRun(facts.conversions) >= 10) badges.push("units-master");
  if (facts.bestStreak >= 4) badges.push("assiduous");
  const persevered = [...facts.evidencesByCompetency.values()].some((evidences) => {
    const history = levelHistory(evidences);
    const firstLow = history.indexOf("not_acquired");
    return firstLow >= 0 && history.slice(firstLow + 1).some(isAcquired);
  });
  if (persevered) badges.push("persevering");
  return badges;
}
