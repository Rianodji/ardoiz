/**
 * Niveau de compétence (big picture §8) : calculé sur les 5 DERNIÈRES preuves ; une preuve est une
 * question corrigée liée à la compétence, avec son taux de réussite (points obtenus / barème).
 * Calcul exact (fractions entières), sans arrondi binaire aux seuils.
 */
export const MASTERY_LEVELS = ["not_assessed", "not_acquired", "in_progress", "acquired", "exceeded"] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

export interface Evidence {
  /** Points obtenus et barème de la question (des demi-points). */
  readonly earned: number;
  readonly points: number;
  readonly recordedAt: Date;
}

export interface Adjustment {
  readonly level: Exclude<MasteryLevel, "not_assessed">;
  readonly adjustedAt: Date;
}

export const LAST_EVIDENCES = 5;

/** Taux moyen des preuves, comme fraction exacte num / den (entiers). */
function averageRate(evidences: readonly Evidence[]): { num: bigint; den: bigint } {
  const parts = evidences.map((evidence) => ({
    e: BigInt(Math.round(evidence.earned * 2)),
    p: BigInt(Math.max(1, Math.round(evidence.points * 2))),
  }));
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const lcm = parts.reduce((acc, part) => (acc * part.p) / gcd(acc, part.p), 1n);
  const num = parts.reduce((sum, part) => sum + part.e * (lcm / part.p), 0n);
  return { num, den: lcm * BigInt(evidences.length) };
}

/** Le taux moyen atteint-il `percent` % ? (comparaison exacte) */
function atLeast(rate: { num: bigint; den: bigint }, percent: number): boolean {
  return rate.num * 100n >= BigInt(percent) * rate.den;
}

/**
 * Niveau calculé (big picture §8) :
 * aucune preuve → non évalué ; < 40 % → non acquis ; 40 à 69 % → en cours d'acquisition ;
 * 70 à 89 % → acquis ; ≥ 90 % ET au moins 3 preuves → dépassé (sinon acquis).
 */
export function computedLevel(evidences: readonly Evidence[]): MasteryLevel {
  const recent = [...evidences].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()).slice(-LAST_EVIDENCES);
  if (recent.length === 0) return "not_assessed";
  const rate = averageRate(recent);
  if (!atLeast(rate, 40)) return "not_acquired";
  if (!atLeast(rate, 70)) return "in_progress";
  if (!atLeast(rate, 90)) return "acquired";
  return recent.length >= 3 ? "exceeded" : "acquired";
}

/** Niveau affiché : l'ajustement du tuteur prime jusqu'à la preuve suivante (big picture §8). */
export function currentLevel(evidences: readonly Evidence[], adjustment: Adjustment | null): MasteryLevel {
  if (adjustment !== null && !evidences.some((evidence) => evidence.recordedAt > adjustment.adjustedAt)) {
    return adjustment.level;
  }
  return computedLevel(evidences);
}

export const isAcquired = (level: MasteryLevel): boolean => level === "acquired" || level === "exceeded";

/** Niveaux calculés successifs, preuve après preuve (pour « passée à Acquis » et « Persévérant »). */
export function levelHistory(evidences: readonly Evidence[]): MasteryLevel[] {
  const ordered = [...evidences].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  return ordered.map((_, index) => computedLevel(ordered.slice(0, index + 1)));
}
