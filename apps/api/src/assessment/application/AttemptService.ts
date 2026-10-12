import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { AssignmentId, AttemptId, LearnerId } from "../../shared-kernel/ids.js";
import { AttemptRefusedError, InvalidAssessmentInput } from "../domain/errors.js";
import { autoGrade, gradeOutOf20, type Answer } from "../domain/grading.js";
import type { Question } from "../domain/questions.js";
import { assertCanStart, assertCanWork, assertDraftSaveAllowed } from "../domain/window.js";
import { canViewAttempt, canWorkOnAssignment } from "./policies.js";
import type {
  AssessmentRecord,
  AssessmentStore,
  AssignmentRecord,
  AttemptRecord,
  OptionAlias,
} from "./ports.js";
import { attemptForLearner, type LearnerAnswerView, type LearnerAttemptView } from "./projections.js";
import { publishAttempt } from "./publication.js";
import { auditOf, authorize, canonicalJson, type AssessmentDependencies } from "./support.js";

export interface AssignmentSummary {
  readonly assignmentId: string;
  readonly title: string;
  readonly opensAt: string;
  readonly dueAt: string;
  readonly lateAllowed: boolean;
  readonly attemptsLeft: number;
  readonly state: "upcoming" | "open" | "in_progress" | "submitted" | "published" | "closed";
  readonly currentAttemptId: string | null;
  readonly grade: number | null;
}

const MAX_TEXT_ANSWER = 2_000;

/**
 * Passage d'une épreuve par l'élève (R5, R6) : commencer, enregistrer un brouillon, rendre.
 * La fenêtre et le nombre de tentatives suivent l'horloge du SERVEUR ; la copie rendue est figée
 * avec son empreinte SHA-256 et corrigée automatiquement dans la même transaction (ADR-0007).
 */
export class AttemptService {
  constructor(private readonly deps: AssessmentDependencies) {}

  /** Les épreuves attribuées à l'élève connecté, avec leur état. */
  async myAssignments(actor: Actor): Promise<AssignmentSummary[]> {
    if (actor.kind !== "learner") return [];
    const learnerId = actor.id;
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assignments = await store.assignments();
      const assessments = await store.assessments();
      const attempts = await store.attemptsOfLearners([learnerId]);
      const titles = new Map(assessments.map((assessment) => [assessment.id, assessment.title]));
      return assignments
        .filter((assignment) => assignment.learnerIds.includes(learnerId))
        .map((assignment) => {
          const mine = attempts
            .filter((attempt) => attempt.assignmentId === assignment.id)
            .sort((a, b) => b.number - a.number);
          const latest = mine[0];
          const open = now >= assignment.opensAt && (now < assignment.dueAt || assignment.lateAllowed);
          const state: AssignmentSummary["state"] =
            latest?.status === "draft"
              ? "in_progress"
              : latest?.status === "published"
                ? "published"
                : latest !== undefined
                  ? "submitted"
                  : now < assignment.opensAt
                    ? "upcoming"
                    : open
                      ? "open"
                      : "closed";
          return {
            assignmentId: assignment.id,
            title: titles.get(assignment.assessmentId) ?? "",
            opensAt: assignment.opensAt.toISOString(),
            dueAt: assignment.dueAt.toISOString(),
            lateAllowed: assignment.lateAllowed,
            attemptsLeft: Math.max(0, assignment.maxAttempts - mine.length),
            state,
            currentAttemptId: latest?.id ?? null,
            // La note n'apparaît qu'après la publication (R5).
            grade: latest?.status === "published" ? latest.grade : null,
          };
        })
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    });
  }

  /** Commence une tentative, ou reprend celle en cours (une seule tentative en cours à la fois, M6). */
  async start(actor: Actor, assignmentId: AssignmentId): Promise<LearnerAttemptView> {
    const context = await this.#context(actor, assignmentId);
    await authorize(
      this.deps,
      actor,
      canWorkOnAssignment(actor, context === null ? null : new Set(context.assignment.learnerIds)),
      "assessment.start",
      assignmentId,
    );
    if (context === null || actor.kind !== "learner") throw new NotFoundError();
    const learnerId = actor.id;
    const { assignment, assessment } = context;
    for (let tries = 0; tries < 2; tries++) {
      const view = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
        const attempts = await store.attemptsOf(assignmentId, learnerId);
        const draft = attempts.find((attempt) => attempt.status === "draft");
        if (draft !== undefined) return attemptForLearner(assessment, assignment, draft, null);
        assertCanStart(assignment, this.deps.clock.now(), attempts.length);
        const attempt = this.#newAttempt(assessment, assignment, learnerId, attempts.length + 1);
        // Deux démarrages simultanés : le second se heurte au numéro unique et recommence (R5).
        if (!(await store.insertAttempt(attempt))) return null;
        return attemptForLearner(assessment, assignment, attempt, null);
      });
      if (view !== null) return view;
    }
    throw new AttemptRefusedError("assessment.no-attempts-left");
  }

  /** La copie de l'élève (ou, pour le parent lié, après publication) : jamais de corrigé avant la publication. */
  async view(actor: Actor, attemptId: AttemptId): Promise<LearnerAttemptView> {
    const found = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const attempt = await store.attemptById(attemptId);
      if (attempt === null) return null;
      const assignment = await store.assignmentById(attempt.assignmentId);
      const assessment = assignment === null ? null : await store.assessmentById(assignment.assessmentId);
      if (assignment === null || assessment === null) return null;
      return {
        attempt,
        assignment,
        assessment,
        results: attempt.status === "published" ? await store.resultsOf(attemptId) : [],
      };
    });
    await authorize(
      this.deps,
      actor,
      canViewAttempt(
        actor,
        found === null
          ? null
          : { learnerId: found.attempt.learnerId, published: found.attempt.status === "published" },
      ),
      "assessment.view-attempt",
      attemptId,
    );
    if (found === null) throw new NotFoundError();
    return attemptForLearner(
      found.assessment,
      found.assignment,
      found.attempt,
      found.attempt.status === "published" ? { results: found.results } : null,
    );
  }

  /** Brouillon : au plus toutes les 5 s, dans la fenêtre, tant que la copie n'est pas rendue (R5, R15). */
  async saveDraft(
    actor: Actor,
    attemptId: AttemptId,
    raw: Readonly<Record<string, LearnerAnswerView>>,
  ): Promise<void> {
    const { attempt, assignment, assessment } = await this.#ownDraft(actor, attemptId);
    const now = this.deps.clock.now();
    assertCanWork(assignment, now);
    assertDraftSaveAllowed(attempt.lastSavedAt, now);
    const answers = translateAnswers(assessment.questions, attempt.optionAliases, raw);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const current = await store.attemptById(attemptId);
      if (current?.status !== "draft") throw new AttemptRefusedError("assessment.attempt-submitted");
      await store.saveDraft(attemptId, answers, now);
    });
  }

  /**
   * Rendre la copie : elle est figée (empreinte SHA-256), corrigée automatiquement côté serveur et,
   * si l'attribution le prévoit et que tout est corrigé, publiée — le tout dans UNE transaction.
   */
  async submit(
    actor: Actor,
    attemptId: AttemptId,
    raw?: Readonly<Record<string, LearnerAnswerView>>,
  ): Promise<LearnerAttemptView> {
    const { attempt, assignment, assessment } = await this.#ownDraft(actor, attemptId);
    const now = this.deps.clock.now();
    const { late } = assertCanWork(assignment, now);
    const answers =
      raw === undefined
        ? attempt.answers
        : translateAnswers(assessment.questions, attempt.optionAliases, raw);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const frozen: AttemptRecord = {
        ...attempt,
        status: "submitted",
        answers,
        answersSha256: this.deps.hasher.sha256(canonicalJson(answers)),
        submittedAt: now,
        late,
      };
      // Deux rendus simultanés : un seul passe (la condition « encore brouillon » est vérifiée par la base).
      if (!(await store.submit(frozen))) throw new AttemptRefusedError("assessment.attempt-submitted");
      const results = assessment.questions.map((question) => {
        const earned = autoGrade(question, answers[question.id]);
        return {
          questionId: question.id,
          earned,
          gradedBy: earned === null ? ("pending" as const) : ("auto" as const),
          comment: null,
          gradedAt: earned === null ? null : now,
        };
      });
      for (const result of results) await store.upsertResult(attemptId, result);
      const grade = gradeOutOf20(
        assessment.questions.map((question, index) => ({
          earned: results[index]?.earned ?? null,
          points: question.points,
        })),
      );
      let final: AttemptRecord = frozen;
      if (grade !== null) {
        await store.updateAttemptStatus(attemptId, "graded", grade, null);
        final = { ...frozen, status: "graded", grade };
        if (assignment.publication === "auto")
          final = await publishAttempt(this.deps, store, actor, assessment, assignment, final, results);
      }
      await store.audit(
        auditOf(this.deps, actor, "assessment.submitted", "success", {
          targetId: attemptId,
          ...(late ? { reasonCode: "late" } : {}),
        }),
      );
      return attemptForLearner(
        assessment,
        assignment,
        final,
        final.status === "published" ? { results } : null,
      );
    });
  }

  async #context(
    actor: Actor,
    assignmentId: AssignmentId,
  ): Promise<{ assignment: AssignmentRecord; assessment: AssessmentRecord } | null> {
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assignment = await store.assignmentById(assignmentId);
      const assessment = assignment === null ? null : await store.assessmentById(assignment.assessmentId);
      return assignment === null || assessment === null ? null : { assignment, assessment };
    });
  }

  async #ownDraft(
    actor: Actor,
    attemptId: AttemptId,
  ): Promise<{ attempt: AttemptRecord; assignment: AssignmentRecord; assessment: AssessmentRecord }> {
    const found = await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      loadAttempt(store, attemptId),
    );
    await authorize(
      this.deps,
      actor,
      canWorkOnAssignment(actor, found === null ? null : new Set([found.attempt.learnerId])),
      "assessment.work-on-attempt",
      attemptId,
    );
    if (found === null) throw new NotFoundError();
    if (found.attempt.status !== "draft") throw new AttemptRefusedError("assessment.attempt-submitted");
    return found;
  }

  #newAttempt(
    assessment: AssessmentRecord,
    assignment: AssignmentRecord,
    learnerId: LearnerId,
    number: number,
  ): AttemptRecord {
    const optionAliases: Record<string, OptionAlias[]> = {};
    for (const question of assessment.questions) {
      if (question.spec.kind !== "mcq") continue;
      // Mélange de Fisher-Yates avec l'aléa du serveur ; alias opaques propres à la tentative (ADR-0007).
      const options = question.spec.options.map((option) => option.id);
      for (let index = options.length - 1; index > 0; index--) {
        const swap = this.deps.random.integer(index + 1);
        [options[index], options[swap]] = [options[swap] ?? "", options[index] ?? ""];
      }
      optionAliases[question.id] = options.map((optionId) => ({ alias: this.deps.random.token(), optionId }));
    }
    return {
      id: this.deps.ids.next("AttemptId"),
      assignmentId: assignment.id,
      learnerId,
      number,
      status: "draft",
      optionAliases,
      answers: {},
      answersSha256: null,
      startedAt: this.deps.clock.now(),
      lastSavedAt: null,
      submittedAt: null,
      late: false,
      grade: null,
      publishedAt: null,
    };
  }
}

export async function loadAttempt(
  store: AssessmentStore,
  attemptId: AttemptId,
): Promise<{ attempt: AttemptRecord; assignment: AssignmentRecord; assessment: AssessmentRecord } | null> {
  const attempt = await store.attemptById(attemptId);
  if (attempt === null) return null;
  const assignment = await store.assignmentById(attempt.assignmentId);
  const assessment = assignment === null ? null : await store.assessmentById(assignment.assessmentId);
  return assignment === null || assessment === null ? null : { attempt, assignment, assessment };
}

/**
 * Réponses reçues de l'élève → réponses de la copie : seules les questions de l'épreuve, du bon type,
 * bornées ; les alias d'options sont traduits en vrais identifiants (un alias inconnu est ignoré).
 */
function translateAnswers(
  questions: readonly Question[],
  aliases: AttemptRecord["optionAliases"],
  raw: Readonly<Record<string, LearnerAnswerView>>,
): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const question of questions) {
    const given = raw[question.id];
    if (given === undefined) continue;
    if (given.kind !== question.spec.kind) throw new InvalidAssessmentInput("assessment.invalid-answer");
    switch (given.kind) {
      case "mcq": {
        const byAlias = new Map((aliases[question.id] ?? []).map((entry) => [entry.alias, entry.optionId]));
        const optionIds = [...new Set(given.optionIds)]
          .map((alias) => byAlias.get(alias))
          .filter((id): id is string => id !== undefined);
        answers[question.id] = { kind: "mcq", optionIds };
        break;
      }
      case "numeric":
        if (given.value.length > 32 || given.unit.length > 8)
          throw new InvalidAssessmentInput("assessment.invalid-answer");
        answers[question.id] = { kind: "numeric", value: given.value, unit: given.unit };
        break;
      case "short_text":
        if (given.text.length > MAX_TEXT_ANSWER)
          throw new InvalidAssessmentInput("assessment.invalid-answer");
        answers[question.id] = { kind: "short_text", text: given.text };
        break;
    }
  }
  return answers;
}
