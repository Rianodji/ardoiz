import type { Pool } from "pg";
import type { AuditEntry, AuditTrail } from "../../shared-kernel/AuditTrail.js";
import { toUuid } from "../ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "./withTenantTransaction.js";

/** Adaptateur du journal d'audit (R12) : table en ajout seul, protégée par RLS et par trigger. */
export class PgAuditTrail implements AuditTrail {
  constructor(private readonly pool: Pool) {}

  async record(entry: AuditEntry): Promise<void> {
    await withTenantTransaction(this.pool, entry.tutorSpaceId, async (client) => {
      await client.query(
        `INSERT INTO audit.audit_log
           (id, tutor_space_id, occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code)
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
    });
  }
}
