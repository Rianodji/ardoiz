/**
 * Points d'expérience (big picture §8, ADR-0009) : ils saluent l'effort et la progression. Valeurs
 * initiales validées par le PO. Aucune pénalité : on ne retire jamais de points (R17).
 */
export const XP_VALUES = {
  "lesson-completed": 10,
  "submitted-on-time": 20,
  "question-succeeded": 5,
  "competency-acquired": 30,
  "session-attended": 15,
} as const;
export type XpReason = keyof typeof XP_VALUES;

/** Une question est réussie à 70 % des points au moins. */
export function questionSucceeded(earned: number, points: number): boolean {
  return points > 0 && Math.round(earned * 2) * 10 >= Math.round(points * 2) * 7;
}

/** Points cumulés pour atteindre le niveau n : 100 × n × (n + 1) / 2. */
export const xpForLevel = (level: number): number => (100 * level * (level + 1)) / 2;

/** Niveau atteint avec `xp` points : le plus grand n tel que 100 × n × (n + 1) / 2 ≤ xp. */
export function levelForXp(xp: number): number {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}
