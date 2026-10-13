import type { Pool, PoolClient } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { BADGES, type Badge } from "../domain/badges.js";
import type { XpReason } from "../domain/experience.js";
import type {
  AdjustmentRecord,
  EvidenceRecord,
  GradeRecord,
  ProgressGateway,
  ProgressStore,
} from "../application/ports.js";

const PROJECTIONS = [
  "evidences",
  "grades",
  "xp_entries",
  "activity_weeks",
  "conversions",
  "submissions",
  "badges",
] as const;
const ADJUSTED_LEVELS = ["not_acquired", "in_progress", "acquired", "exceeded"] as const;

/** Adaptateur Postgres de la progression, sur la connexion de la transaction courante (R10). */
export class PgProgressStore implements ProgressStore {
  constructor(
    private readonly client: PoolClient,
    private readonly tutorSpaceId: TutorSpaceId,
  ) {}

  get #space(): string {
    return toUuid(this.tutorSpaceId);
  }

  async insertEvidence(learnerId: LearnerId, evidence: EvidenceRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO progress.evidences (tutor_space_id, learner_id, competency_id, attempt_id, question_id, earned, points, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [
        this.#space,
        toUuid(learnerId),
        toUuid(evidence.competencyId),
        toUuid(evidence.attemptId),
        toUuid(evidence.questionId),
        evidence.earned,
        evidence.points,
        evidence.recordedAt,
      ],
    );
  }

  async updateEvidenceEarned(
    attemptId: string,
    questionId: string,
    earned: number,
    points: number,
  ): Promise<void> {
    await this.client.query(
      `UPDATE progress.evidences SET earned = $3, points = $4 WHERE attempt_id = $1 AND question_id = $2`,
      [toUuid(attemptId), toUuid(questionId), earned, points],
    );
  }

  async evidencesOf(learnerId: LearnerId): Promise<EvidenceRecord[]> {
    const { rows } = await this.client.query<{
      competency_id: string;
      attempt_id: string;
      question_id: string;
      earned: string;
      points: string;
      recorded_at: Date;
    }>(
      `SELECT competency_id, attempt_id, question_id, earned, points, recorded_at FROM progress.evidences
        WHERE learner_id = $1 ORDER BY recorded_at, attempt_id, question_id`,
      [toUuid(learnerId)],
    );
    return rows.map((row) => ({
      competencyId: fromUuid("CompetencyId", row.competency_id),
      attemptId: fromUuid("AttemptId", row.attempt_id),
      copyId: fromUuid("AttemptId", row.attempt_id),
      questionId: fromUuid("QuestionId", row.question_id),
      earned: Number(row.earned),
      points: Number(row.points),
      recordedAt: row.recorded_at,
    }));
  }

  async upsertGrade(learnerId: LearnerId, grade: GradeRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO progress.grades (tutor_space_id, attempt_id, learner_id, subject_id, title, grade, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (attempt_id) DO NOTHING`,
      [
        this.#space,
        toUuid(grade.attemptId),
        toUuid(learnerId),
        toUuid(grade.subjectId),
        grade.title,
        grade.grade,
        grade.publishedAt,
      ],
    );
  }

  async updateGrade(attemptId: string, grade: number): Promise<void> {
    await this.client.query(`UPDATE progress.grades SET grade = $2 WHERE attempt_id = $1`, [
      toUuid(attemptId),
      grade,
    ]);
  }

  async gradesOf(learnerId: LearnerId): Promise<GradeRecord[]> {
    const { rows } = await this.client.query<{
      attempt_id: string;
      subject_id: string;
      title: string;
      grade: string;
      published_at: Date;
    }>(
      `SELECT attempt_id, subject_id, title, grade, published_at FROM progress.grades WHERE learner_id = $1 ORDER BY published_at, attempt_id`,
      [toUuid(learnerId)],
    );
    return rows.map((row) => ({
      attemptId: fromUuid("AttemptId", row.attempt_id),
      subjectId: fromUuid("SubjectId", row.subject_id),
      title: row.title,
      grade: Number(row.grade),
      publishedAt: row.published_at,
    }));
  }

  async addXp(
    learnerId: LearnerId,
    reason: XpReason,
    source: string,
    points: number,
    at: Date,
  ): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO progress.xp_entries (tutor_space_id, learner_id, reason, source, points, earned_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(learnerId), reason, source, points, at],
    );
    return result.rowCount === 1;
  }

  async xpOf(learnerId: LearnerId): Promise<number> {
    const { rows } = await this.client.query<{ total: number }>(
      `SELECT COALESCE(sum(points), 0)::int AS total FROM progress.xp_entries WHERE learner_id = $1`,
      [toUuid(learnerId)],
    );
    return rows[0]?.total ?? 0;
  }

  async addActivityWeek(learnerId: LearnerId, monday: string): Promise<void> {
    await this.client.query(
      `INSERT INTO progress.activity_weeks (tutor_space_id, learner_id, week) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(learnerId), monday],
    );
  }

  async activityWeeksOf(learnerId: LearnerId): Promise<Set<string>> {
    const { rows } = await this.client.query<{ week: string }>(
      `SELECT to_char(week, 'YYYY-MM-DD') AS week FROM progress.activity_weeks WHERE learner_id = $1`,
      [toUuid(learnerId)],
    );
    return new Set(rows.map((row) => row.week));
  }

  async recordConversion(
    learnerId: LearnerId,
    attemptId: string,
    questionId: string,
    succeeded: boolean,
    at: Date,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO progress.conversions (tutor_space_id, learner_id, attempt_id, question_id, succeeded, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(learnerId), toUuid(attemptId), toUuid(questionId), succeeded, at],
    );
  }

  async updateConversion(attemptId: string, questionId: string, succeeded: boolean): Promise<void> {
    await this.client.query(
      `UPDATE progress.conversions SET succeeded = $3 WHERE attempt_id = $1 AND question_id = $2`,
      [toUuid(attemptId), toUuid(questionId), succeeded],
    );
  }

  async conversionsOf(learnerId: LearnerId): Promise<boolean[]> {
    const { rows } = await this.client.query<{ succeeded: boolean }>(
      `SELECT succeeded FROM progress.conversions WHERE learner_id = $1 ORDER BY recorded_at, attempt_id, question_id`,
      [toUuid(learnerId)],
    );
    return rows.map((row) => row.succeeded);
  }

  async recordSubmission(
    learnerId: LearnerId,
    attemptId: string,
    submittedAt: Date,
    late: boolean,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO progress.submissions (tutor_space_id, attempt_id, learner_id, submitted_at, late)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(attemptId), toUuid(learnerId), submittedAt, late],
    );
  }

  async submissionCount(learnerId: LearnerId): Promise<number> {
    const { rows } = await this.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM progress.submissions WHERE learner_id = $1`,
      [toUuid(learnerId)],
    );
    return rows[0]?.n ?? 0;
  }

  async addBadge(learnerId: LearnerId, badge: Badge, at: Date): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO progress.badges (tutor_space_id, learner_id, badge, awarded_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(learnerId), badge, at],
    );
    return result.rowCount === 1;
  }

  async badgesOf(learnerId: LearnerId): Promise<Array<{ badge: Badge; awardedAt: Date }>> {
    const { rows } = await this.client.query<{ badge: string; awarded_at: Date }>(
      `SELECT badge, awarded_at FROM progress.badges WHERE learner_id = $1 ORDER BY awarded_at, badge`,
      [toUuid(learnerId)],
    );
    return rows.flatMap((row) => {
      const badge = BADGES.find((candidate) => candidate === row.badge);
      return badge === undefined ? [] : [{ badge, awardedAt: row.awarded_at }];
    });
  }

  async insertAdjustment(
    learnerId: LearnerId,
    adjustment: AdjustmentRecord & { id: string; adjustedBy: string },
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO progress.competency_adjustments (id, tutor_space_id, learner_id, competency_id, level, justification, adjusted_at, adjusted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        toUuid(adjustment.id),
        this.#space,
        toUuid(learnerId),
        toUuid(adjustment.competencyId),
        adjustment.level,
        adjustment.justification,
        adjustment.adjustedAt,
        toUuid(adjustment.adjustedBy),
      ],
    );
  }

  async adjustmentsOf(learnerId: LearnerId): Promise<AdjustmentRecord[]> {
    const { rows } = await this.client.query<{
      competency_id: string;
      level: string;
      justification: string;
      adjusted_at: Date;
    }>(
      `SELECT competency_id, level, justification, adjusted_at FROM progress.competency_adjustments
        WHERE learner_id = $1 ORDER BY adjusted_at, id`,
      [toUuid(learnerId)],
    );
    return rows.flatMap((row) => {
      const level = ADJUSTED_LEVELS.find((candidate) => candidate === row.level);
      return level === undefined
        ? []
        : [
            {
              competencyId: fromUuid("CompetencyId", row.competency_id),
              level,
              justification: row.justification,
              adjustedAt: row.adjusted_at,
            },
          ];
    });
  }

  async learnersWithProgress(): Promise<LearnerId[]> {
    const { rows } = await this.client.query<{ learner_id: string }>(
      `SELECT DISTINCT learner_id FROM (
         SELECT learner_id FROM progress.xp_entries UNION SELECT learner_id FROM progress.evidences
         UNION SELECT learner_id FROM progress.competency_adjustments) AS known`,
    );
    return rows.map((row) => fromUuid("LearnerId", row.learner_id));
  }

  async clearProjections(): Promise<void> {
    for (const table of PROJECTIONS) await this.client.query(`DELETE FROM progress.${table}`);
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
}

export class PgProgressGateway implements ProgressGateway {
  constructor(private readonly pool: Pool) {}

  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: ProgressStore) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, tutorSpaceId, (client) =>
      work(new PgProgressStore(client, tutorSpaceId)),
    );
  }
}
