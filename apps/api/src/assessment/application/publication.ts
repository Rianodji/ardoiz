import type { Actor } from "../../identity/index.js";
import type {
  AssessmentRecord,
  AssessmentStore,
  AssignmentRecord,
  AttemptRecord,
  QuestionResult,
} from "./ports.js";
import { auditOf, type AssessmentDependencies } from "./support.js";

/** Événement d'intégration : la correction d'une copie est publiée (glossaire : CorrectionPubliée). */
export const CORRECTION_PUBLISHED = "assessment.correction-published";
/** Événement d'intégration : une copie est rendue (glossaire : CopieRendue), pour la série et les points. */
export const ATTEMPT_SUBMITTED = "assessment.attempt-submitted";
/** Événement d'intégration : une note publiée est rectifiée (glossaire : NoteRectifiée). */
export const GRADE_RECTIFIED = "assessment.grade-rectified";
/** Événement d'intégration : le tuteur révèle le corrigé d'une attribution (glossaire : CorrigéRévélé). */
export const ANSWERS_REVEALED = "assessment.answers-revealed";

/**
 * Publie une copie corrigée : statut, date, audit et événement `CorrectionPubliée` écrits dans la
 * MÊME transaction (outbox, ADR-0004). L'événement porte, par question, les points obtenus, le barème et
 * les compétences évaluées, pour la progression (L6) ; aucun contenu de copie ni réponse attendue n'y
 * figure (minimisation).
 */
export async function publishAttempt(
  deps: Pick<AssessmentDependencies, "ids" | "clock">,
  store: AssessmentStore,
  actor: Actor,
  assessment: AssessmentRecord,
  assignment: AssignmentRecord,
  attempt: AttemptRecord,
  results: readonly QuestionResult[],
): Promise<AttemptRecord> {
  const now = deps.clock.now();
  await store.updateAttemptStatus(attempt.id, "published", attempt.grade, now);
  const earned = new Map(results.map((result) => [result.questionId as string, result.earned ?? 0]));
  await store.publish({
    id: deps.ids.next("EventId"),
    type: CORRECTION_PUBLISHED,
    tutorSpaceId: actor.tutorSpaceId,
    occurredAt: now,
    payload: {
      attemptId: attempt.id,
      assignmentId: assignment.id,
      assessmentId: assessment.id,
      subjectId: assessment.subjectId,
      title: assessment.title,
      learnerId: attempt.learnerId,
      grade: attempt.grade,
      publishedAt: now.toISOString(),
      questions: assessment.questions.map((question) => ({
        questionId: question.id,
        kind: question.spec.kind,
        // Une question numérique à unité imposée est un exercice de conversion (badge « Maître des unités »).
        conversion: question.spec.kind === "numeric" && question.spec.unitMode === "imposed",
        earned: earned.get(question.id) ?? 0,
        points: question.points,
        competencyIds: [...question.competencyIds],
      })),
    },
  });
  await store.audit(auditOf(deps, actor, "assessment.published", "success", { targetId: attempt.id }));
  return { ...attempt, status: "published", publishedAt: now };
}
