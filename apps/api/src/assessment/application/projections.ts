import type { Answer } from "../domain/grading.js";
import type { Question } from "../domain/questions.js";
import { quantityOfQuestion } from "../domain/questions.js";
import { unitsOf } from "../domain/units.js";
import type {
  AssessmentRecord,
  AssignmentRecord,
  AttemptRecord,
  QuestionResult,
  RectificationRecord,
} from "./ports.js";

/**
 * Deux projections distinctes d'une épreuve (ADR-0007), construites par deux fonctions séparées :
 * - `assessmentForAuthor` : tout, pour le tuteur ;
 * - `attemptForLearner` : ce que l'élève peut voir. Avant la RÉVÉLATION du corrigé, elle ne contient
 *   AUCUNE réponse attendue, tolérance, unité attendue, explication ni point par option (R5, M6) : elle
 *   ne lit `question.spec` que pour les énoncés d'options, à travers les alias. La publication montre
 *   seulement la note et les points obtenus (verdict L3, R-1).
 */

export interface AuthorQuestionView {
  readonly id: string;
  readonly kind: Question["spec"]["kind"];
  readonly prompt: string;
  readonly points: number;
  readonly competencyIds: readonly string[];
  readonly explanation: string | null;
  readonly spec: Question["spec"];
}

export function assessmentForAuthor(assessment: AssessmentRecord, assigned: boolean) {
  return {
    id: assessment.id,
    subjectId: assessment.subjectId,
    title: assessment.title,
    assigned,
    questions: assessment.questions.map((question): AuthorQuestionView => ({
      id: question.id,
      kind: question.spec.kind,
      prompt: question.prompt,
      points: question.points,
      competencyIds: [...question.competencyIds],
      explanation: question.explanation,
      spec: question.spec,
    })),
  };
}

/** Une question vue par l'élève : énoncé, barème de la question, et ce qu'il faut pour répondre. */
export type LearnerQuestionView =
  | {
      readonly id: string;
      readonly kind: "mcq";
      readonly prompt: string;
      readonly points: number;
      readonly options: ReadonlyArray<{ readonly id: string; readonly text: string }>;
    }
  | {
      readonly id: string;
      readonly kind: "numeric";
      readonly prompt: string;
      readonly points: number;
      readonly units: readonly string[];
    }
  | { readonly id: string; readonly kind: "short_text"; readonly prompt: string; readonly points: number };

/** Réponse de l'élève telle qu'il la revoit : avec les identifiants opaques de SA tentative. */
export type LearnerAnswerView =
  | { readonly kind: "mcq"; readonly optionIds: readonly string[] }
  | { readonly kind: "numeric"; readonly value: string; readonly unit: string }
  | { readonly kind: "short_text"; readonly text: string };

/** Ce qui apparaît à la PUBLICATION : la note et les points obtenus par question, sans réponse attendue. */
export interface PublishedCorrection {
  readonly grade: number;
  readonly questions: ReadonlyArray<{
    readonly questionId: string;
    readonly earned: number;
    readonly comment: string | null;
  }>;
}

/**
 * Ce qui n'apparaît qu'à la RÉVÉLATION du corrigé (verdict L3, R-1) : réponses attendues et explications,
 * pour tous les élèves de l'attribution à la fois.
 */
export interface AnswerKey {
  readonly questions: ReadonlyArray<{
    readonly questionId: string;
    readonly explanation: string | null;
    readonly expected:
      | { readonly kind: "mcq"; readonly correctOptionIds: readonly string[] }
      | {
          readonly kind: "numeric";
          readonly expected: string;
          readonly unit: string;
          readonly unitMode: "imposed" | "free";
        }
      | { readonly kind: "short_text"; readonly modelAnswer: string | null };
  }>;
}

export interface LearnerAttemptView {
  readonly attemptId: string;
  readonly assignmentId: string;
  readonly title: string;
  readonly status: AttemptRecord["status"];
  readonly number: number;
  readonly dueAt: string;
  readonly late: boolean;
  readonly submittedAt: string | null;
  readonly questions: readonly LearnerQuestionView[];
  readonly answers: Readonly<Record<string, LearnerAnswerView>>;
  readonly correction: PublishedCorrection | null;
  readonly answerKey: AnswerKey | null;
}

function learnerQuestion(question: Question, attempt: AttemptRecord): LearnerQuestionView {
  const base = { id: question.id, prompt: question.prompt, points: question.points };
  switch (question.spec.kind) {
    case "mcq": {
      const texts = new Map(question.spec.options.map((option) => [option.id, option.text]));
      // Ordre et identifiants propres à la tentative : rien ne relie l'alias à la position d'origine.
      return {
        ...base,
        kind: "mcq",
        options: (attempt.optionAliases[question.id] ?? []).map((alias) => ({
          id: alias.alias,
          text: texts.get(alias.optionId) ?? "",
        })),
      };
    }
    case "numeric":
      // Seule la GRANDEUR est montrée (pour proposer les unités), jamais l'unité ni la valeur attendues.
      return { ...base, kind: "numeric", units: unitsOf(quantityOfQuestion(question.spec)) };
    case "short_text":
      return { ...base, kind: "short_text" };
  }
}

/** Traduit les vrais identifiants d'options en alias de la tentative (et inversement à l'enregistrement). */
export function toLearnerAnswer(
  answer: Answer,
  aliases: readonly { alias: string; optionId: string }[],
): LearnerAnswerView {
  if (answer.kind !== "mcq") return answer;
  const byOption = new Map(aliases.map((entry) => [entry.optionId, entry.alias]));
  return {
    kind: "mcq",
    optionIds: answer.optionIds.map((id) => byOption.get(id) ?? "").filter((id) => id !== ""),
  };
}

export function attemptForLearner(
  assessment: AssessmentRecord,
  assignment: AssignmentRecord,
  attempt: AttemptRecord,
  published: { results: readonly QuestionResult[] } | null,
  /** `answersRevealed(assignment, now)` : décidé par le domaine, jamais par l'appelant HTTP. */
  revealed: boolean,
): LearnerAttemptView {
  const isPublished = attempt.status === "published" && attempt.grade !== null && published !== null;
  const answers: Record<string, LearnerAnswerView> = {};
  for (const [questionId, answer] of Object.entries(attempt.answers)) {
    answers[questionId] = toLearnerAnswer(answer, attempt.optionAliases[questionId] ?? []);
  }
  return {
    attemptId: attempt.id,
    assignmentId: assignment.id,
    title: assessment.title,
    status: attempt.status,
    number: attempt.number,
    dueAt: assignment.dueAt.toISOString(),
    late: attempt.late,
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    questions: assessment.questions.map((question) => learnerQuestion(question, attempt)),
    answers,
    // La note n'est construite QUE pour une copie publiée (R5, ADR-0007)…
    correction: isPublished ? correctionFor(assessment, attempt, published.results) : null,
    // …et le corrigé QUE pour une copie publiée dont l'attribution a révélé son corrigé (R5, R-1 du verdict L3).
    answerKey: isPublished && revealed ? answerKeyFor(assessment, attempt) : null,
  };
}

function correctionFor(
  assessment: AssessmentRecord,
  attempt: AttemptRecord,
  results: readonly QuestionResult[],
): PublishedCorrection {
  const earned = new Map(results.map((result) => [result.questionId as string, result]));
  return {
    grade: attempt.grade ?? 0,
    questions: assessment.questions.map((question) => {
      const result = earned.get(question.id);
      return { questionId: question.id, earned: result?.earned ?? 0, comment: result?.comment ?? null };
    }),
  };
}

function answerKeyFor(assessment: AssessmentRecord, attempt: AttemptRecord): AnswerKey {
  return {
    questions: assessment.questions.map((question) => {
      const { spec } = question;
      const aliases = attempt.optionAliases[question.id] ?? [];
      const expected: AnswerKey["questions"][number]["expected"] =
        spec.kind === "mcq"
          ? {
              kind: "mcq",
              correctOptionIds: aliases
                .filter((entry) => spec.correctOptionIds.includes(entry.optionId))
                .map((entry) => entry.alias),
            }
          : spec.kind === "numeric"
            ? { kind: "numeric", expected: spec.expected, unit: spec.unit, unitMode: spec.unitMode }
            : { kind: "short_text", modelAnswer: spec.modelAnswer };
      return { questionId: question.id, explanation: question.explanation, expected };
    }),
  };
}

/** Vue complète d'une copie pour le tuteur : réponses, résultats, rectifications. */
export function attemptForTutor(
  assessment: AssessmentRecord,
  attempt: AttemptRecord,
  results: readonly QuestionResult[],
  rectifications: readonly RectificationRecord[],
) {
  return {
    attemptId: attempt.id,
    assignmentId: attempt.assignmentId,
    learnerId: attempt.learnerId,
    title: assessment.title,
    status: attempt.status,
    number: attempt.number,
    late: attempt.late,
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    answersSha256: attempt.answersSha256,
    grade: attempt.grade,
    questions: assessmentForAuthor(assessment, true).questions,
    answers: attempt.answers,
    results: results.map((result) => ({ ...result, gradedAt: result.gradedAt?.toISOString() ?? null })),
    rectifications: rectifications.map((entry) => ({
      ...entry,
      rectifiedAt: entry.rectifiedAt.toISOString(),
    })),
  };
}
