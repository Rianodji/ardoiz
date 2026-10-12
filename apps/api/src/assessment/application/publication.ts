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

/**
 * Publie une copie corrigée : statut, date, audit et événement `CorrectionPubliée` écrits dans la
 * MÊME transaction (outbox, ADR-0004). Les résultats par compétence voyagent dans l'événement ; aucun
 * contenu de copie ni réponse attendue n'y figure (minimisation).
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
      learnerId: attempt.learnerId,
      grade: attempt.grade,
      competencies: assessment.questions.flatMap((question) =>
        question.competencyIds.map((competencyId) => ({
          competencyId,
          earned: earned.get(question.id) ?? 0,
          points: question.points,
        })),
      ),
    },
  });
  await store.audit(auditOf(deps, actor, "assessment.published", "success", { targetId: attempt.id }));
  return { ...attempt, status: "published", publishedAt: now };
}
