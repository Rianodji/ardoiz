import type { Pool, PoolClient } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { appendToOutbox } from "../../platform/messaging/PgOutbox.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type {
  AssessmentId,
  AssignmentId,
  AttemptId,
  LearnerId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import type { Answer } from "../domain/grading.js";
import { parseSpec, type Question, type QuestionSpec } from "../domain/questions.js";
import type {
  AssessmentGateway,
  AssessmentRecord,
  AssessmentStore,
  AssignmentRecord,
  AttemptRecord,
  AttemptStatus,
  OptionAlias,
  QuestionResult,
  RectificationRecord,
} from "../application/ports.js";

interface QuestionRow {
  id: string;
  assessment_id: string;
  position: number;
  prompt: string;
  points: string;
  explanation: string | null;
  spec: QuestionSpec;
  competency_ids: string[];
}

interface AttemptRow {
  id: string;
  assignment_id: string;
  learner_id: string;
  number: number;
  status: AttemptStatus;
  option_aliases: Record<string, OptionAlias[]>;
  answers: Record<string, Answer>;
  answers_sha256: string | null;
  started_at: Date;
  last_saved_at: Date | null;
  submitted_at: Date | null;
  late: boolean;
  grade: string | null;
  published_at: Date | null;
}

/**
 * La partie « attendue » relue en base repasse par le validateur : une donnée altérée hors de
 * l'application n'est jamais utilisée pour corriger (R5).
 */
function storedSpec(spec: QuestionSpec): QuestionSpec {
  if (spec.kind === "mcq") {
    const correctOptions = spec.correctOptionIds.map((id) =>
      spec.options.findIndex((option) => option.id === id),
    );
    return parseSpec({ kind: "mcq", options: spec.options, correctOptions });
  }
  return parseSpec({ ...spec });
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: fromUuid("QuestionId", row.id),
    position: row.position,
    prompt: row.prompt,
    points: Number(row.points),
    explanation: row.explanation,
    competencyIds: row.competency_ids.map((id) => fromUuid("CompetencyId", id)),
    spec: storedSpec(row.spec),
  };
}

function toAttempt(row: AttemptRow): AttemptRecord {
  return {
    id: fromUuid("AttemptId", row.id),
    assignmentId: fromUuid("AssignmentId", row.assignment_id),
    learnerId: fromUuid("LearnerId", row.learner_id),
    number: row.number,
    status: row.status,
    optionAliases: row.option_aliases,
    answers: row.answers,
    answersSha256: row.answers_sha256,
    startedAt: row.started_at,
    lastSavedAt: row.last_saved_at,
    submittedAt: row.submitted_at,
    late: row.late,
    grade: row.grade === null ? null : Number(row.grade),
    publishedAt: row.published_at,
  };
}

const ATTEMPT_COLUMNS = `id, assignment_id, learner_id, number, status, option_aliases, answers, answers_sha256,
  started_at, last_saved_at, submitted_at, late, grade, published_at`;

/** Adaptateur Postgres de l'évaluation, dans une transaction déclarée à la RLS (R10). */
export class PgAssessmentStore implements AssessmentStore {
  constructor(
    private readonly client: PoolClient,
    private readonly tutorSpaceId: TutorSpaceId,
  ) {}

  get #space(): string {
    return toUuid(this.tutorSpaceId);
  }

  async #questions(assessmentIds: readonly string[]): Promise<Map<string, Question[]>> {
    const result = await this.client.query<QuestionRow>(
      `SELECT q.id, q.assessment_id, q.position, q.prompt, q.points, q.explanation, q.spec,
              COALESCE(array_agg(qc.competency_id ORDER BY qc.competency_id) FILTER (WHERE qc.competency_id IS NOT NULL), '{}') AS competency_ids
         FROM assessment.questions q
         LEFT JOIN assessment.question_competencies qc ON qc.question_id = q.id
        WHERE q.assessment_id = ANY($1::uuid[])
        GROUP BY q.id
        ORDER BY q.position`,
      [assessmentIds],
    );
    const byAssessment = new Map<string, Question[]>();
    for (const row of result.rows) {
      const list = byAssessment.get(row.assessment_id) ?? [];
      list.push(toQuestion(row));
      byAssessment.set(row.assessment_id, list);
    }
    return byAssessment;
  }

  async assessments(): Promise<AssessmentRecord[]> {
    const result = await this.client.query<{
      id: string;
      subject_id: string;
      title: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, subject_id, title, created_at, updated_at FROM assessment.assessments ORDER BY created_at, id`,
    );
    const questions = await this.#questions(result.rows.map((row) => row.id));
    return result.rows.map((row) => ({
      id: fromUuid("AssessmentId", row.id),
      subjectId: fromUuid("SubjectId", row.subject_id),
      title: row.title,
      questions: questions.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async assessmentById(id: AssessmentId): Promise<AssessmentRecord | null> {
    return (await this.assessments()).find((assessment) => assessment.id === id) ?? null;
  }

  async insertAssessment(assessment: AssessmentRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO assessment.assessments (id, tutor_space_id, subject_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        toUuid(assessment.id),
        this.#space,
        toUuid(assessment.subjectId),
        assessment.title,
        assessment.createdAt,
        assessment.updatedAt,
      ],
    );
  }

  async replaceQuestions(
    assessmentId: AssessmentId,
    questions: readonly Question[],
    at: Date,
  ): Promise<void> {
    await this.client.query(
      `DELETE FROM assessment.question_competencies WHERE question_id IN (SELECT id FROM assessment.questions WHERE assessment_id = $1)`,
      [toUuid(assessmentId)],
    );
    await this.client.query(`DELETE FROM assessment.questions WHERE assessment_id = $1`, [
      toUuid(assessmentId),
    ]);
    for (const question of questions) {
      await this.client.query(
        `INSERT INTO assessment.questions (id, tutor_space_id, assessment_id, position, kind, prompt, points, explanation, spec)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          toUuid(question.id),
          this.#space,
          toUuid(assessmentId),
          question.position,
          question.spec.kind,
          question.prompt,
          question.points,
          question.explanation,
          JSON.stringify(question.spec),
        ],
      );
      for (const competencyId of question.competencyIds) {
        await this.client.query(
          `INSERT INTO assessment.question_competencies (tutor_space_id, question_id, competency_id) VALUES ($1, $2, $3)`,
          [this.#space, toUuid(question.id), toUuid(competencyId)],
        );
      }
    }
    await this.client.query(`UPDATE assessment.assessments SET updated_at = $2 WHERE id = $1`, [
      toUuid(assessmentId),
      at,
    ]);
  }

  async isAssigned(assessmentId: AssessmentId): Promise<boolean> {
    const result = await this.client.query(
      `SELECT 1 FROM assessment.assignments WHERE assessment_id = $1 LIMIT 1`,
      [toUuid(assessmentId)],
    );
    return result.rowCount === 1;
  }

  async assignments(): Promise<AssignmentRecord[]> {
    const result = await this.client.query<{
      id: string;
      assessment_id: string;
      opens_at: Date;
      due_at: Date;
      max_attempts: number;
      late_allowed: boolean;
      publication: "auto" | "manual";
      created_at: Date;
      created_by: string;
      learner_ids: string[];
    }>(
      `SELECT a.id, a.assessment_id, a.opens_at, a.due_at, a.max_attempts, a.late_allowed, a.publication, a.created_at, a.created_by,
              COALESCE(array_agg(al.learner_id ORDER BY al.learner_id) FILTER (WHERE al.learner_id IS NOT NULL), '{}') AS learner_ids
         FROM assessment.assignments a
         LEFT JOIN assessment.assignment_learners al ON al.assignment_id = a.id
        GROUP BY a.id
        ORDER BY a.due_at, a.id`,
    );
    return result.rows.map((row) => ({
      id: fromUuid("AssignmentId", row.id),
      assessmentId: fromUuid("AssessmentId", row.assessment_id),
      opensAt: row.opens_at,
      dueAt: row.due_at,
      maxAttempts: row.max_attempts,
      lateAllowed: row.late_allowed,
      publication: row.publication,
      learnerIds: row.learner_ids.map((id) => fromUuid("LearnerId", id)),
      createdAt: row.created_at,
      createdBy: fromUuid("TutorId", row.created_by),
    }));
  }

  async assignmentById(id: AssignmentId): Promise<AssignmentRecord | null> {
    return (await this.assignments()).find((assignment) => assignment.id === id) ?? null;
  }

  async insertAssignment(assignment: AssignmentRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO assessment.assignments (id, tutor_space_id, assessment_id, opens_at, due_at, max_attempts, late_allowed, publication, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        toUuid(assignment.id),
        this.#space,
        toUuid(assignment.assessmentId),
        assignment.opensAt,
        assignment.dueAt,
        assignment.maxAttempts,
        assignment.lateAllowed,
        assignment.publication,
        assignment.createdAt,
        toUuid(assignment.createdBy),
      ],
    );
    for (const learnerId of new Set(assignment.learnerIds)) {
      await this.client.query(
        `INSERT INTO assessment.assignment_learners (tutor_space_id, assignment_id, learner_id) VALUES ($1, $2, $3)`,
        [this.#space, toUuid(assignment.id), toUuid(learnerId)],
      );
    }
  }

  async attemptsOf(assignmentId: AssignmentId, learnerId: LearnerId): Promise<AttemptRecord[]> {
    const result = await this.client.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM assessment.attempts WHERE assignment_id = $1 AND learner_id = $2 ORDER BY number`,
      [toUuid(assignmentId), toUuid(learnerId)],
    );
    return result.rows.map(toAttempt);
  }

  async attemptsOfLearners(learnerIds: readonly LearnerId[]): Promise<AttemptRecord[]> {
    const result = await this.client.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM assessment.attempts WHERE learner_id = ANY($1::uuid[]) ORDER BY started_at, id`,
      [learnerIds.map(toUuid)],
    );
    return result.rows.map(toAttempt);
  }

  async attemptsToGrade(): Promise<AttemptRecord[]> {
    const result = await this.client.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM assessment.attempts WHERE status IN ('submitted', 'graded') ORDER BY submitted_at, id`,
    );
    return result.rows.map(toAttempt);
  }

  async attemptById(id: AttemptId): Promise<AttemptRecord | null> {
    const result = await this.client.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM assessment.attempts WHERE id = $1`,
      [toUuid(id)],
    );
    const row = result.rows[0];
    return row === undefined ? null : toAttempt(row);
  }

  async insertAttempt(attempt: AttemptRecord): Promise<boolean> {
    // Numéro de tentative unique et une seule tentative en cours : un démarrage concurrent ne passe pas (R5, M6).
    const result = await this.client.query(
      `INSERT INTO assessment.attempts (id, tutor_space_id, assignment_id, learner_id, number, status, option_aliases, answers, started_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        toUuid(attempt.id),
        this.#space,
        toUuid(attempt.assignmentId),
        toUuid(attempt.learnerId),
        attempt.number,
        JSON.stringify(attempt.optionAliases),
        JSON.stringify(attempt.answers),
        attempt.startedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async saveDraft(id: AttemptId, answers: AttemptRecord["answers"], at: Date): Promise<void> {
    await this.client.query(
      `UPDATE assessment.attempts SET answers = $2, last_saved_at = $3 WHERE id = $1 AND status = 'draft'`,
      [toUuid(id), JSON.stringify(answers), at],
    );
  }

  async submit(attempt: AttemptRecord): Promise<boolean> {
    // La condition « encore brouillon » est réévaluée sous verrou de ligne : un second rendu concurrent ne passe pas.
    const result = await this.client.query(
      `UPDATE assessment.attempts
          SET status = 'submitted', answers = $2, answers_sha256 = $3, submitted_at = $4, late = $5
        WHERE id = $1 AND status = 'draft'`,
      [
        toUuid(attempt.id),
        JSON.stringify(attempt.answers),
        attempt.answersSha256,
        attempt.submittedAt,
        attempt.late,
      ],
    );
    return result.rowCount === 1;
  }

  async updateAttemptStatus(
    id: AttemptId,
    status: AttemptStatus,
    grade: number | null,
    publishedAt: Date | null,
  ): Promise<void> {
    await this.client.query(
      `UPDATE assessment.attempts SET status = $2, grade = $3, published_at = $4 WHERE id = $1`,
      [toUuid(id), status, grade, publishedAt],
    );
  }

  async resultsOf(attemptId: AttemptId): Promise<QuestionResult[]> {
    const result = await this.client.query<{
      question_id: string;
      earned: string | null;
      graded_by: QuestionResult["gradedBy"];
      comment: string | null;
      graded_at: Date | null;
    }>(
      `SELECT question_id, earned, graded_by, comment, graded_at FROM assessment.question_results WHERE attempt_id = $1 ORDER BY question_id`,
      [toUuid(attemptId)],
    );
    return result.rows.map((row) => ({
      questionId: fromUuid("QuestionId", row.question_id),
      earned: row.earned === null ? null : Number(row.earned),
      gradedBy: row.graded_by,
      comment: row.comment,
      gradedAt: row.graded_at,
    }));
  }

  async upsertResult(attemptId: AttemptId, result: QuestionResult): Promise<void> {
    await this.client.query(
      `INSERT INTO assessment.question_results (tutor_space_id, attempt_id, question_id, earned, graded_by, comment, graded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (attempt_id, question_id) DO UPDATE
         SET earned = EXCLUDED.earned, graded_by = EXCLUDED.graded_by, comment = EXCLUDED.comment, graded_at = EXCLUDED.graded_at`,
      [
        this.#space,
        toUuid(attemptId),
        toUuid(result.questionId),
        result.earned,
        result.gradedBy,
        result.comment,
        result.gradedAt,
      ],
    );
  }

  async enableRectification(): Promise<void> {
    // Local à la transaction : la base n'accepte la modification d'une note publiée que dans celle-ci (R6).
    await this.client.query(`SELECT set_config('app.rectification', 'on', true)`);
  }

  async insertRectification(entry: RectificationRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO assessment.grade_rectifications
         (id, tutor_space_id, attempt_id, question_id, previous_earned, new_earned, previous_grade, new_grade, reason, rectified_at, rectified_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        toUuid(entry.id),
        this.#space,
        toUuid(entry.attemptId),
        toUuid(entry.questionId),
        entry.previousEarned,
        entry.newEarned,
        entry.previousGrade,
        entry.newGrade,
        entry.reason,
        entry.rectifiedAt,
        toUuid(entry.rectifiedBy),
      ],
    );
  }

  async rectificationsOf(attemptId: AttemptId): Promise<RectificationRecord[]> {
    const result = await this.client.query<{
      id: string;
      question_id: string;
      previous_earned: string;
      new_earned: string;
      previous_grade: string;
      new_grade: string;
      reason: string;
      rectified_at: Date;
      rectified_by: string;
    }>(
      `SELECT id, question_id, previous_earned, new_earned, previous_grade, new_grade, reason, rectified_at, rectified_by
         FROM assessment.grade_rectifications WHERE attempt_id = $1 ORDER BY rectified_at, id`,
      [toUuid(attemptId)],
    );
    return result.rows.map((row) => ({
      id: fromUuid("RectificationId", row.id),
      attemptId,
      questionId: fromUuid("QuestionId", row.question_id),
      previousEarned: Number(row.previous_earned),
      newEarned: Number(row.new_earned),
      previousGrade: Number(row.previous_grade),
      newGrade: Number(row.new_grade),
      reason: row.reason,
      rectifiedAt: row.rectified_at,
      rectifiedBy: fromUuid("TutorId", row.rectified_by),
    }));
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        toUuid(entry.id),
        toUuid(entry.tutorSpaceId),
        entry.occurredAt,
        entry.action,
        entry.actor.kind,
        entry.actor.kind === "system" ? null : entry.actor.id,
        entry.targetId ?? null,
        entry.outcome,
        entry.reasonCode ?? null,
      ],
    );
  }

  async publish(event: IntegrationEvent): Promise<void> {
    await appendToOutbox(this.client, event);
  }
}

export class PgAssessmentGateway implements AssessmentGateway {
  constructor(private readonly pool: Pool) {}

  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: AssessmentStore) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, tutorSpaceId, (client) =>
      work(new PgAssessmentStore(client, tutorSpaceId)),
    );
  }
}
