import type { Question } from "./questions.js";
import { Rational } from "./Rational.js";
import { convert } from "./units.js";

/** Réponse d'un élève à une question, après traduction des identifiants opaques d'options. */
export type Answer =
  | { readonly kind: "mcq"; readonly optionIds: readonly string[] }
  | { readonly kind: "numeric"; readonly value: string; readonly unit: string }
  | { readonly kind: "short_text"; readonly text: string }
  /** La copie ne garde que l'empreinte de la scène : la scène est stockée à part, figée avec la copie (R6). */
  | { readonly kind: "notebook"; readonly sceneSha256: string };

/**
 * QCM : toutes les bonnes options et elles seules. QUESTION Q15 : le barème partiel d'un QCM à
 * plusieurs bonnes réponses n'est pas défini ; option restrictive : tout ou rien.
 */
export function isMcqCorrect(correctOptionIds: readonly string[], chosen: readonly string[]): boolean {
  const expected = new Set(correctOptionIds);
  const given = new Set(chosen);
  return expected.size === given.size && [...expected].every((id) => given.has(id));
}

/**
 * Réponse numérique (big picture §8) : correcte si |réponse − attendue| ≤ tolérance, DANS l'unité
 * attendue. Unité imposée : une autre unité est fausse, même équivalente. Unité libre : la réponse
 * est convertie si l'unité est de la même grandeur. Calcul exact, sans arrondi binaire.
 */
export function isNumericCorrect(
  spec: { expected: string; tolerance: string; unit: string; unitMode: "imposed" | "free" },
  answer: { value: string; unit: string },
): boolean {
  const value = Rational.parseDecimal(answer.value);
  const expected = Rational.parseDecimal(spec.expected);
  const tolerance = Rational.parseDecimal(spec.tolerance);
  if (value === null || expected === null || tolerance === null) return false;
  if (spec.unitMode === "imposed" && answer.unit !== spec.unit) return false;
  const inExpectedUnit = convert(value, answer.unit, spec.unit);
  if (inExpectedUnit === null) return false;
  return inExpectedUnit.sub(expected).abs().compare(tolerance) <= 0;
}

/**
 * Correction automatique côté serveur (ADR-0007) : points obtenus, ou null quand la question attend
 * une correction manuelle (réponse courte, cahier). Une réponse absente ou d'un autre type vaut 0.
 */
export function autoGrade(question: Question, answer: Answer | undefined): number | null {
  const { spec } = question;
  switch (spec.kind) {
    case "short_text":
    case "notebook":
      return null;
    case "mcq":
      return answer?.kind === "mcq" && isMcqCorrect(spec.correctOptionIds, answer.optionIds)
        ? question.points
        : 0;
    case "numeric":
      return answer?.kind === "numeric" && isNumericCorrect(spec, answer) ? question.points : 0;
  }
}

/**
 * Note d'une copie (big picture §8) : somme des points obtenus / somme du barème, ramenée sur 20 et
 * arrondie au demi-point. Null tant qu'une question attend une correction manuelle.
 */
export function gradeOutOf20(
  results: ReadonlyArray<{ readonly earned: number | null; readonly points: number }>,
): number | null {
  if (results.some((result) => result.earned === null)) return null;
  const total = results.reduce((sum, result) => sum.add(halves(result.points)), Rational.int(0));
  if (total.compare(Rational.int(0)) === 0) return null;
  const earned = results.reduce((sum, result) => sum.add(halves(result.earned ?? 0)), Rational.int(0));
  return earned.div(total).mul(Rational.int(20)).roundToHalf().toNumber();
}

/** Les points sont des demi-points : représentation exacte en rationnel. */
function halves(points: number): Rational {
  return Rational.of(BigInt(Math.round(points * 2)), 2n);
}
