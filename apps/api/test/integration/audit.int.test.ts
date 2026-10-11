import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toUuid } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { PgAuditTrail } from "../../src/platform/postgres/PgAuditTrail.js";
import { withTenantTransaction } from "../../src/platform/postgres/withTenantTransaction.js";
import type { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import { appPool, clock, createTutorSpace, ids, ownerClient } from "./database.js";

describe("Journal d'audit en ajout seul (R12)", () => {
  let pool: pg.Pool;
  let space: TutorSpaceId;
  let entryId: string;

  beforeAll(async () => {
    pool = appPool();
    space = await createTutorSpace(pool, "Espace audité");
    const id = ids.next("AuditEntryId");
    entryId = toUuid(id);
    await new PgAuditTrail(pool).record({
      id,
      tutorSpaceId: space,
      action: "access.denied",
      actor: { kind: "guardian", id: ids.next("GuardianId") },
      targetId: ids.next("LearnerId"),
      outcome: "denied",
      reasonCode: "hidden",
      occurredAt: clock.now(),
    });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("enregistre une entrée lisible dans son espace (R12)", async () => {
    const { rows } = await withTenantTransaction(pool, space, (client) =>
      client.query<{ action: string; outcome: string; reason_code: string }>(
        "SELECT action, outcome, reason_code FROM audit.audit_log WHERE id = $1",
        [entryId],
      ),
    );
    expect(rows).toEqual([{ action: "access.denied", outcome: "denied", reason_code: "hidden" }]);
  });

  it.each([
    ["UPDATE", "UPDATE audit.audit_log SET outcome = 'success'"],
    ["DELETE", "DELETE FROM audit.audit_log"],
    ["TRUNCATE", "TRUNCATE audit.audit_log"],
  ])("refuse %s au rôle d'exécution (R12)", async (_label, sql) => {
    await expect(withTenantTransaction(pool, space, (client) => client.query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each([
    ["UPDATE", "UPDATE audit.audit_log SET outcome = 'success'"],
    ["DELETE", "DELETE FROM audit.audit_log"],
    ["TRUNCATE", "TRUNCATE audit.audit_log"],
  ])("refuse %s même au propriétaire, par trigger (R12)", async (_label, sql) => {
    const owner = await ownerClient();
    try {
      await owner.query("BEGIN");
      await owner.query("SELECT set_config('app.tutor_space_id', $1, true)", [toUuid(space)]);
      await expect(owner.query(sql)).rejects.toThrow(/ajout seul/);
    } finally {
      await owner.query("ROLLBACK");
      await owner.end();
    }
  });

  it("refuse du texte libre à la place d'un code d'action (R12, R21)", async () => {
    await expect(
      withTenantTransaction(pool, space, (client) =>
        client.query(
          `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, outcome)
           VALUES ($1, $2, $3, 'Lina a eu 4/20 en géométrie', 'system', 'success')`,
          [toUuid(ids.next("AuditEntryId")), toUuid(space), clock.now()],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
