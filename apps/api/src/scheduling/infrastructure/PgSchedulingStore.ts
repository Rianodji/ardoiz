import type { Pool, PoolClient } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { appendToOutbox } from "../../platform/messaging/PgOutbox.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type {
  LearnerId,
  SessionOccurrenceId,
  TutoringSessionId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import { parseRecurrence, type Recurrence } from "../domain/schedule.js";
import type {
  OccurrenceRecord,
  SchedulingGateway,
  SchedulingStore,
  SessionRecord,
} from "../application/ports.js";

interface SessionRow {
  id: string;
  title: string;
  meeting_link: string;
  recurrence: Recurrence;
  created_at: Date;
  created_by: string;
  link_changed_at: Date;
  learner_ids: string[];
}

interface OccurrenceRow {
  id: string;
  session_id: string;
  starts_at: Date;
  ends_at: Date;
  moved: boolean;
  cancelled_at: Date | null;
}

const toOccurrence = (row: OccurrenceRow): OccurrenceRecord => ({
  id: fromUuid("SessionOccurrenceId", row.id),
  sessionId: fromUuid("TutoringSessionId", row.session_id),
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  moved: row.moved,
  cancelledAt: row.cancelled_at,
});

const OCCURRENCE_COLUMNS = "id, session_id, starts_at, ends_at, moved, cancelled_at";

/** Adaptateur Postgres de la planification, dans une transaction déclarée à la RLS (R10). */
export class PgSchedulingStore implements SchedulingStore {
  constructor(
    private readonly client: PoolClient,
    private readonly tutorSpaceId: TutorSpaceId,
  ) {}

  get #space(): string {
    return toUuid(this.tutorSpaceId);
  }

  async sessions(): Promise<SessionRecord[]> {
    const result = await this.client.query<SessionRow>(
      `SELECT s.id, s.title, s.meeting_link, s.recurrence, s.created_at, s.created_by, s.link_changed_at,
              COALESCE(array_agg(p.learner_id ORDER BY p.learner_id) FILTER (WHERE p.learner_id IS NOT NULL), '{}') AS learner_ids
         FROM scheduling.tutoring_sessions s
         LEFT JOIN scheduling.session_participants p ON p.session_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at, s.id`,
    );
    return result.rows.map((row) => ({
      id: fromUuid("TutoringSessionId", row.id),
      title: row.title,
      meetingLink: row.meeting_link,
      // La règle relue en base repasse par le validateur du domaine.
      recurrence: parseRecurrence(row.recurrence),
      learnerIds: row.learner_ids.map((id) => fromUuid("LearnerId", id)),
      createdAt: row.created_at,
      createdBy: fromUuid("TutorId", row.created_by),
      linkChangedAt: row.link_changed_at,
    }));
  }

  async sessionById(id: TutoringSessionId): Promise<SessionRecord | null> {
    return (await this.sessions()).find((session) => session.id === id) ?? null;
  }

  async insertSession(session: SessionRecord, occurrences: readonly OccurrenceRecord[]): Promise<void> {
    await this.client.query(
      `INSERT INTO scheduling.tutoring_sessions (id, tutor_space_id, title, meeting_link, recurrence, created_at, created_by, link_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        toUuid(session.id),
        this.#space,
        session.title,
        session.meetingLink,
        JSON.stringify(session.recurrence),
        session.createdAt,
        toUuid(session.createdBy),
        session.linkChangedAt,
      ],
    );
    for (const learnerId of session.learnerIds) {
      await this.client.query(
        `INSERT INTO scheduling.session_participants (tutor_space_id, session_id, learner_id) VALUES ($1, $2, $3)`,
        [this.#space, toUuid(session.id), toUuid(learnerId)],
      );
    }
    for (const occurrence of occurrences) {
      await this.client.query(
        `INSERT INTO scheduling.session_occurrences (id, tutor_space_id, session_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [toUuid(occurrence.id), this.#space, toUuid(session.id), occurrence.startsAt, occurrence.endsAt],
      );
    }
  }

  async changeLink(id: TutoringSessionId, link: string, at: Date): Promise<void> {
    await this.client.query(
      `UPDATE scheduling.tutoring_sessions SET meeting_link = $2, link_changed_at = $3 WHERE id = $1`,
      [toUuid(id), link, at],
    );
  }

  async occurrencesBetween(from: Date, to: Date): Promise<OccurrenceRecord[]> {
    const result = await this.client.query<OccurrenceRow>(
      `SELECT ${OCCURRENCE_COLUMNS} FROM scheduling.session_occurrences
        WHERE starts_at < $2 AND ends_at > $1 ORDER BY starts_at, id`,
      [from, to],
    );
    return result.rows.map(toOccurrence);
  }

  async occurrencesOf(sessionId: TutoringSessionId): Promise<OccurrenceRecord[]> {
    const result = await this.client.query<OccurrenceRow>(
      `SELECT ${OCCURRENCE_COLUMNS} FROM scheduling.session_occurrences WHERE session_id = $1 ORDER BY starts_at, id`,
      [toUuid(sessionId)],
    );
    return result.rows.map(toOccurrence);
  }

  async occurrenceById(id: SessionOccurrenceId): Promise<OccurrenceRecord | null> {
    const result = await this.client.query<OccurrenceRow>(
      `SELECT ${OCCURRENCE_COLUMNS} FROM scheduling.session_occurrences WHERE id = $1`,
      [toUuid(id)],
    );
    const row = result.rows[0];
    return row === undefined ? null : toOccurrence(row);
  }

  async moveOccurrence(id: SessionOccurrenceId, startsAt: Date, endsAt: Date): Promise<void> {
    await this.client.query(
      `UPDATE scheduling.session_occurrences SET starts_at = $2, ends_at = $3, moved = true WHERE id = $1`,
      [toUuid(id), startsAt, endsAt],
    );
  }

  async cancelOccurrence(id: SessionOccurrenceId, at: Date): Promise<void> {
    await this.client.query(`UPDATE scheduling.session_occurrences SET cancelled_at = $2 WHERE id = $1`, [
      toUuid(id),
      at,
    ]);
  }

  async recordAttendance(
    occurrenceId: SessionOccurrenceId,
    learnerId: LearnerId,
    at: Date,
  ): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO scheduling.session_attendance (tutor_space_id, occurrence_id, learner_id, joined_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(occurrenceId), toUuid(learnerId), at],
    );
    return result.rowCount === 1;
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

export class PgSchedulingGateway implements SchedulingGateway {
  constructor(private readonly pool: Pool) {}

  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: SchedulingStore) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, tutorSpaceId, (client) =>
      work(new PgSchedulingStore(client, tutorSpaceId)),
    );
  }
}
