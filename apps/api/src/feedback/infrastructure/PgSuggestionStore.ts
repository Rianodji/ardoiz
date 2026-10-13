import type { Pool, PoolClient } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { GuardianId, SuggestionId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { CATEGORIES, STATUSES } from "../domain/suggestion.js";
import type {
  SuggestionGateway,
  SuggestionRecord,
  SuggestionStore,
} from "../application/SuggestionService.js";

interface Row {
  id: string;
  guardian_id: string;
  category: string;
  body: string;
  created_at: Date;
  status: string;
  reply: string | null;
  updated_at: Date | null;
}

const COLUMNS = "id, guardian_id, category, body, created_at, status, reply, updated_at";

function toRecord(row: Row): SuggestionRecord {
  return {
    id: fromUuid("SuggestionId", row.id),
    guardianId: fromUuid("GuardianId", row.guardian_id),
    category: CATEGORIES.find((category) => category === row.category) ?? "other",
    body: row.body,
    createdAt: row.created_at,
    status: STATUSES.find((status) => status === row.status) ?? "new",
    reply: row.reply,
    updatedAt: row.updated_at,
  };
}

/** Adaptateur Postgres des suggestions, dans une transaction déclarée à la RLS (R10). */
export class PgSuggestionStore implements SuggestionStore {
  constructor(
    private readonly client: PoolClient,
    private readonly tutorSpaceId: TutorSpaceId,
  ) {}

  async insert(suggestion: SuggestionRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO feedback.suggestions (id, tutor_space_id, guardian_id, category, body, created_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'new')`,
      [
        toUuid(suggestion.id),
        toUuid(this.tutorSpaceId),
        toUuid(suggestion.guardianId),
        suggestion.category,
        suggestion.body,
        suggestion.createdAt,
      ],
    );
  }

  async byId(id: SuggestionId): Promise<SuggestionRecord | null> {
    const { rows } = await this.client.query<Row>(
      `SELECT ${COLUMNS} FROM feedback.suggestions WHERE id = $1`,
      [toUuid(id)],
    );
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async all(): Promise<SuggestionRecord[]> {
    const { rows } = await this.client.query<Row>(
      `SELECT ${COLUMNS} FROM feedback.suggestions ORDER BY created_at DESC, id`,
    );
    return rows.map(toRecord);
  }

  async ofGuardian(guardianId: GuardianId): Promise<SuggestionRecord[]> {
    const { rows } = await this.client.query<Row>(
      `SELECT ${COLUMNS} FROM feedback.suggestions WHERE guardian_id = $1 ORDER BY created_at DESC, id`,
      [toUuid(guardianId)],
    );
    return rows.map(toRecord);
  }

  async sentSince(guardianId: GuardianId, since: Date): Promise<Date[]> {
    const { rows } = await this.client.query<{ created_at: Date }>(
      `SELECT created_at FROM feedback.suggestions WHERE guardian_id = $1 AND created_at > $2`,
      [toUuid(guardianId), since],
    );
    return rows.map((row) => row.created_at);
  }

  async update(
    id: SuggestionId,
    status: SuggestionRecord["status"],
    reply: string | null,
    at: Date,
  ): Promise<void> {
    await this.client.query(
      `UPDATE feedback.suggestions SET status = $2, reply = $3, updated_at = $4 WHERE id = $1`,
      [toUuid(id), status, reply, at],
    );
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

export class PgSuggestionGateway implements SuggestionGateway {
  constructor(private readonly pool: Pool) {}

  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: SuggestionStore) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, tutorSpaceId, (client) =>
      work(new PgSuggestionStore(client, tutorSpaceId)),
    );
  }
}
