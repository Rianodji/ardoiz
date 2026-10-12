import type { CompetencyId, QuestionId } from "../../shared-kernel/ids.js";
import { InvalidAssessmentInput } from "./errors.js";
import { Rational } from "./Rational.js";
import { isUnit, quantityOf, type Quantity } from "./units.js";

export interface McqOption {
  readonly id: string;
  readonly text: string;
}

/** Ce qui est attendu pour chaque type de question. Ces données ne quittent JAMAIS le serveur avant la publication (R5). */
export type QuestionSpec =
  | {
      readonly kind: "mcq";
      readonly options: readonly McqOption[];
      readonly correctOptionIds: readonly string[];
    }
  | {
      readonly kind: "numeric";
      readonly expected: string;
      readonly tolerance: string;
      readonly unit: string;
      /** « imposed » : une autre unité est fausse, même équivalente (exercice de conversion) ; « free » : convertie. */
      readonly unitMode: "imposed" | "free";
    }
  | { readonly kind: "short_text"; readonly modelAnswer: string | null }
  /** Devoir sur le cahier virtuel (ADR-0004) : corrigé par le tuteur ; la réponse modèle est un texte. */
  | { readonly kind: "notebook"; readonly modelAnswer: string | null };

export interface Question {
  readonly id: QuestionId;
  readonly position: number;
  readonly prompt: string;
  /** Barème : de 0,5 à 100 points, par demi-point. */
  readonly points: number;
  /** Au moins une compétence évaluée (big picture §5). */
  readonly competencyIds: readonly CompetencyId[];
  /** Corrigé, montré seulement après la publication de la correction. */
  readonly explanation: string | null;
  readonly spec: QuestionSpec;
}

export type QuestionKind = QuestionSpec["kind"];

function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a) continue;
    if (
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    )
      return true;
  }
  return false;
}

/** Texte simple, borné, sans caractère de contrôle ; rendu comme du texte (R4). */
export function plainText(raw: unknown, max: number, code: `assessment.invalid-${string}`): string {
  if (typeof raw !== "string") throw new InvalidAssessmentInput(code);
  const value = raw.normalize("NFC").trim();
  if (value.length === 0 || value.length > max || hasForbiddenCharacter(value))
    throw new InvalidAssessmentInput(code);
  return value;
}

/** Points d'un barème ou d'une note de question : multiples de 0,5. */
export function halfPoints(raw: unknown, min: number, max: number): number {
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max ||
    !Number.isInteger(raw * 2)
  ) {
    throw new InvalidAssessmentInput("assessment.invalid-points");
  }
  return raw;
}

/** Valide la partie « attendue » d'une question, saisie par le tuteur. */
export function parseSpec(raw: { kind: QuestionKind } & Record<string, unknown>): QuestionSpec {
  switch (raw.kind) {
    case "mcq": {
      const options = raw["options"];
      if (!Array.isArray(options) || options.length < 2 || options.length > 8)
        throw new InvalidAssessmentInput("assessment.invalid-options");
      const parsed = options.map((option: unknown, index) => ({
        id: `o${String(index + 1)}`,
        text: plainText(
          typeof option === "object" && option !== null && "text" in option ? option.text : undefined,
          300,
          "assessment.invalid-options",
        ),
      }));
      if (new Set(parsed.map((option) => option.text)).size !== parsed.length)
        throw new InvalidAssessmentInput("assessment.invalid-options");
      const correct = raw["correctOptions"];
      if (!Array.isArray(correct) || correct.length === 0)
        throw new InvalidAssessmentInput("assessment.invalid-correct-options");
      const correctOptionIds = [...new Set(correct)].map((index: unknown) => {
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= parsed.length) {
          throw new InvalidAssessmentInput("assessment.invalid-correct-options");
        }
        return `o${String(index + 1)}`;
      });
      return { kind: "mcq", options: parsed, correctOptionIds };
    }
    case "numeric": {
      const expected = typeof raw["expected"] === "string" ? Rational.parseDecimal(raw["expected"]) : null;
      const tolerance = typeof raw["tolerance"] === "string" ? Rational.parseDecimal(raw["tolerance"]) : null;
      if (expected === null) throw new InvalidAssessmentInput("assessment.invalid-expected");
      if (tolerance === null || tolerance.compare(Rational.int(0)) < 0)
        throw new InvalidAssessmentInput("assessment.invalid-tolerance");
      const unit = raw["unit"];
      if (typeof unit !== "string" || !isUnit(unit))
        throw new InvalidAssessmentInput("assessment.invalid-unit");
      const unitMode = raw["unitMode"];
      if (unitMode !== "imposed" && unitMode !== "free")
        throw new InvalidAssessmentInput("assessment.invalid-unit-mode");
      return {
        kind: "numeric",
        expected: String(raw["expected"]).trim(),
        tolerance: String(raw["tolerance"]).trim(),
        unit,
        unitMode,
      };
    }
    case "short_text": {
      const model = raw["modelAnswer"];
      return {
        kind: "short_text",
        modelAnswer:
          model === undefined || model === null || model === ""
            ? null
            : plainText(model, 1000, "assessment.invalid-model-answer"),
      };
    }
    case "notebook": {
      const model = raw["modelAnswer"];
      return {
        kind: "notebook",
        modelAnswer:
          model === undefined || model === null || model === ""
            ? null
            : plainText(model, 1000, "assessment.invalid-model-answer"),
      };
    }
  }
}

/** Grandeur d'une question numérique : la seule information donnée à l'élève (pour choisir son unité). */
export function quantityOfQuestion(spec: QuestionSpec & { kind: "numeric" }): Quantity {
  const quantity = quantityOf(spec.unit);
  if (quantity === null) throw new InvalidAssessmentInput("assessment.invalid-unit");
  return quantity;
}
