import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { AssignmentId, AttemptId, LearnerId, QuestionId } from "../../shared-kernel/ids.js";
import { GradingError } from "../domain/errors.js";
import { gradeOutOf20 } from "../domain/grading.js";
import { halfPoints, plainText } from "../domain/questions.js";
import { loadAttempt } from "./AttemptService.js";
import { canAuthorOrGrade, canViewResults } from "./policies.js";
import { attemptForTutor } from "./projections.js";
import type { AttemptRecord, QuestionResult } from "./ports.js";
import { ANSWERS_REVEALED, publishAttempt } from "./publication.js";
import { auditOf, authorize, type AssessmentDependencies } from "./support.js";

export interface GradeInput {
  readonly questionId: QuestionId;
  readonly earned: unknown;
  readonly comment?: unknown;
}

/**
 * Correction par le tuteur (R6, R12) : file des copies à corriger, correction manuelle, publication,
 * rectification motivée d'une note publiée. La copie rendue, elle, ne change jamais (trigger R6).
 */
export class GradingService {
  constructor(private readonly deps: AssessmentDependencies) {}

  /** File de correction : copies rendues non publiées, les plus anciennes d'abord. */
  async queue(actor: Actor) {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.grading-queue");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const attempts = await store.attemptsToGrade();
      const assignments = await store.assignments();
      const assessments = await store.assessments();
      const titleOf = new Map(
        assignments.map((assignment) => [
          assignment.id as string,
          assessments.find((a) => a.id === assignment.assessmentId)?.title ?? "",
        ]),
      );
      return attempts.map((attempt) => ({
        attemptId: attempt.id,
        assignmentId: attempt.assignmentId,
        learnerId: attempt.learnerId,
        title: titleOf.get(attempt.assignmentId) ?? "",
        status: attempt.status,
        late: attempt.late,
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        grade: attempt.grade,
      }));
    });
  }

  async detail(actor: Actor, attemptId: AttemptId) {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.read-attempt", attemptId);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const found = await loadAttempt(store, attemptId);
      if (found === null) throw new NotFoundError();
      return attemptForTutor(
        found.assessment,
        found.attempt,
        await store.resultsOf(attemptId),
        await store.rectificationsOf(attemptId),
      );
    });
  }

  /** Corrige des questions d'une copie rendue, non publiée ; la note est recalculée par le serveur. */
  async grade(actor: Actor, attemptId: AttemptId, inputs: readonly GradeInput[]) {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.grade", attemptId);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const found = await loadAttempt(store, attemptId);
      if (found === null) throw new NotFoundError();
      const { attempt, assessment } = found;
      if (attempt.status === "draft") throw new GradingError("assessment.not-gradable");
      if (attempt.status === "published") throw new GradingError("assessment.already-published");
      const now = this.deps.clock.now();
      const existing = new Map(
        (await store.resultsOf(attemptId)).map((result) => [result.questionId as string, result]),
      );
      for (const input of inputs) {
        const question = assessment.questions.find((candidate) => candidate.id === input.questionId);
        if (question === undefined) throw new NotFoundError();
        const result: QuestionResult = {
          questionId: question.id,
          earned: halfPoints(input.earned, 0, question.points),
          gradedBy: "tutor",
          comment:
            input.comment === undefined || input.comment === null || input.comment === ""
              ? null
              : plainText(input.comment, 1000, "assessment.invalid-comment"),
          gradedAt: now,
        };
        existing.set(question.id, result);
        await store.upsertResult(attemptId, result);
      }
      const grade = gradeOutOf20(
        assessment.questions.map((question) => ({
          earned: existing.get(question.id)?.earned ?? null,
          points: question.points,
        })),
      );
      await store.updateAttemptStatus(attemptId, grade === null ? "submitted" : "graded", grade, null);
      await store.audit(auditOf(this.deps, actor, "assessment.graded", "success", { targetId: attemptId }));
    });
  }

  /** Publie une copie entièrement corrigée : aucune note publiée tant qu'une question attend (big picture §8). */
  async publish(actor: Actor, attemptId: AttemptId): Promise<void> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.publish", attemptId);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const found = await loadAttempt(store, attemptId);
      if (found === null) throw new NotFoundError();
      const { attempt, assignment, assessment } = found;
      if (attempt.status === "published") throw new GradingError("assessment.already-published");
      if (attempt.status !== "graded" || attempt.grade === null)
        throw new GradingError("assessment.grading-incomplete");
      await publishAttempt(
        this.deps,
        store,
        actor,
        assessment,
        assignment,
        attempt,
        await store.resultsOf(attemptId),
      );
    });
  }

  /**
   * Rectifie une note publiée : motif obligatoire, ancienne et nouvelle valeurs historisées en ajout
   * seul, audit (R6, R12). La copie rendue reste identique ; seul le résultat change.
   */
  async rectify(
    actor: Actor,
    attemptId: AttemptId,
    questionId: QuestionId,
    rawEarned: unknown,
    rawReason: unknown,
  ): Promise<void> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.rectify", attemptId);
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    let reason: string;
    try {
      reason = plainText(rawReason, 500, "assessment.invalid-reason");
    } catch {
      throw new GradingError("assessment.reason-required");
    }
    if (reason.length < 5) throw new GradingError("assessment.reason-required");
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const found = await loadAttempt(store, attemptId);
      if (found === null) throw new NotFoundError();
      const { attempt, assessment } = found;
      if (attempt.status !== "published" || attempt.grade === null)
        throw new GradingError("assessment.not-published");
      const question = assessment.questions.find((candidate) => candidate.id === questionId);
      if (question === undefined) throw new NotFoundError();
      const newEarned = halfPoints(rawEarned, 0, question.points);
      const results = await store.resultsOf(attemptId);
      const previous = results.find((result) => result.questionId === questionId);
      const updated = results.map((result) =>
        result.questionId === questionId ? { ...result, earned: newEarned } : result,
      );
      const newGrade = gradeOutOf20(
        assessment.questions.map((q) => ({
          earned: updated.find((r) => r.questionId === q.id)?.earned ?? null,
          points: q.points,
        })),
      );
      if (newGrade === null) throw new GradingError("assessment.grading-incomplete");
      const now = this.deps.clock.now();
      // La ligne de rectification est la PREUVE exigée par la base au COMMIT pour changer une note
      // publiée (trigger différé, verdict L3 R-3) : sans elle, la transaction est refusée.
      await store.insertRectification({
        id: this.deps.ids.next("RectificationId"),
        attemptId,
        questionId,
        previousEarned: previous?.earned ?? 0,
        newEarned,
        previousGrade: attempt.grade,
        newGrade,
        reason,
        rectifiedAt: now,
        rectifiedBy: tutorId,
      });
      await store.upsertResult(attemptId, {
        questionId,
        earned: newEarned,
        gradedBy: "tutor",
        comment: previous?.comment ?? null,
        gradedAt: now,
      });
      await store.updateAttemptStatus(attemptId, "published", newGrade, attempt.publishedAt);
      await store.audit(
        auditOf(this.deps, actor, "assessment.rectified", "success", { targetId: attemptId }),
      );
    });
  }

  /**
   * Révèle le corrigé d'une attribution à tous ses élèves en même temps (verdict L3, R-1) : seul moyen
   * quand le retard est autorisé. Audité, événement `CorrigéRévélé` dans l'outbox, même transaction.
   */
  async reveal(actor: Actor, assignmentId: AssignmentId): Promise<void> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.reveal", assignmentId);
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assignment = await store.assignmentById(assignmentId);
      if (assignment === null) throw new NotFoundError();
      const now = this.deps.clock.now();
      // Une seconde demande ne change rien : la date de la première révélation est conservée.
      if (!(await store.revealAnswers(assignmentId, now, tutorId))) return;
      await store.publish({
        id: this.deps.ids.next("EventId"),
        type: ANSWERS_REVEALED,
        tutorSpaceId: actor.tutorSpaceId,
        occurredAt: now,
        payload: { assignmentId, assessmentId: assignment.assessmentId, revealedAt: now.toISOString() },
      });
      await store.audit(
        auditOf(this.deps, actor, "assessment.answers-revealed", "success", { targetId: assignmentId }),
      );
    });
  }

  /** Résultats publiés d'un élève (élève lui-même, parent lié, tuteur) : rien d'autre que publié. */
  async publishedResults(actor: Actor, learnerId: LearnerId) {
    const inSpace = (await this.deps.learners.existingLearners(actor.tutorSpaceId, [learnerId])).length === 1;
    await authorize(
      this.deps,
      actor,
      canViewResults(actor, learnerId, inSpace),
      "assessment.view-results",
      learnerId,
    );
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const attempts = await store.attemptsOfLearners([learnerId]);
      const assignments = await store.assignments();
      const assessments = await store.assessments();
      return attempts
        .filter(
          (attempt): attempt is AttemptRecord & { publishedAt: Date } =>
            attempt.status === "published" && attempt.publishedAt !== null,
        )
        .map((attempt) => {
          const assignment = assignments.find((candidate) => candidate.id === attempt.assignmentId);
          return {
            attemptId: attempt.id,
            title: assessments.find((assessment) => assessment.id === assignment?.assessmentId)?.title ?? "",
            grade: attempt.grade,
            publishedAt: attempt.publishedAt.toISOString(),
          };
        });
    });
  }
}
