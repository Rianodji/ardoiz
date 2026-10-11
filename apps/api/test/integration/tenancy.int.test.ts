import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toUuid } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../src/platform/postgres/withTenantTransaction.js";
import type { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import { appPool, clock, createTutorSpace, ids, ownerClient } from "./database.js";

/** Insère une entrée d'audit dans l'espace donné : une ligne métier quelconque de cet espace. */
const insertAuditRow = (client: pg.PoolClient, space: TutorSpaceId) =>
  client.query(
    `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, outcome)
     VALUES ($1, $2, $3, 'test.row', 'system', 'success')`,
    [toUuid(ids.next("AuditEntryId")), toUuid(space), clock.now()],
  );

describe("Isolation des espaces tuteurs par la RLS forcée (R10, ADR-0002)", () => {
  let pool: pg.Pool;
  let spaceA: TutorSpaceId;
  let spaceB: TutorSpaceId;

  beforeAll(async () => {
    pool = appPool();
    spaceA = await createTutorSpace(pool, "Espace A");
    spaceB = await createTutorSpace(pool, "Espace B");
    await withTenantTransaction(pool, spaceA, (client) => insertAuditRow(client, spaceA));
  });
  afterAll(async () => {
    await pool.end();
  });

  it("une ligne de l'espace A est invisible depuis l'espace B, même sans aucun filtre applicatif (R10)", async () => {
    const seenFromB = await withTenantTransaction(pool, spaceB, async (client) => {
      const audit = await client.query("SELECT * FROM audit.audit_log"); // volontairement sans WHERE
      const spaces = await client.query<{ id: string }>("SELECT id FROM tenancy.tutor_spaces");
      return { audit: audit.rowCount, spaces: spaces.rows.map((row) => row.id) };
    });
    expect(seenFromB.audit).toBe(0);
    expect(seenFromB.spaces).toEqual([toUuid(spaceB)]);

    const seenFromA = await withTenantTransaction(pool, spaceA, (client) =>
      client.query("SELECT * FROM audit.audit_log"),
    );
    expect(seenFromA.rowCount).toBe(1);
  });

  it("sans espace déclaré, aucune ligne n'est visible (échec en mode fermé, R10, R18)", async () => {
    const audit = await pool.query("SELECT * FROM audit.audit_log");
    const spaces = await pool.query("SELECT * FROM tenancy.tutor_spaces");
    expect(audit.rowCount).toBe(0);
    expect(spaces.rowCount).toBe(0);
  });

  it("refuse d'écrire une ligne d'un autre espace que celui de la transaction (R10)", async () => {
    await expect(
      withTenantTransaction(pool, spaceB, (client) => insertAuditRow(client, spaceA)),
    ).rejects.toThrow(/row-level security/);
  });

  it("l'espace déclaré ne survit pas à la transaction : la connexion rendue au pool est vierge (R10)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tutor_space_id', $1, true)", [toUuid(spaceA)]);
      await client.query("COMMIT");
      const { rows } = await client.query<{ space: string | null }>(
        "SELECT tenancy.current_tutor_space() AS space",
      );
      expect(rows[0]?.space).toBeNull();
    } finally {
      client.release();
    }
  });

  it("une valeur d'espace forgée fait échouer la requête au lieu d'ouvrir l'accès (R18)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tutor_space_id', $1, true)", ["' OR true --"]);
      await expect(client.query("SELECT * FROM audit.audit_log")).rejects.toThrow(
        /invalid input syntax for type uuid/,
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("Garde-fous du schéma, vérifiés sur toutes les tables (R10)", () => {
  let owner: pg.Client;
  beforeAll(async () => {
    owner = await ownerClient();
  });
  afterAll(async () => {
    await owner.end();
  });

  /** Tables techniques hors du périmètre métier, auxquelles le rôle d'exécution n'a aucun droit. */
  const TECHNICAL_TABLES = ["public.schema_migrations"];

  it("la RLS est activée ET forcée sur chaque table accessible au rôle d'exécution (R10)", async () => {
    const { rows } = await owner.query<{ name: string; enabled: boolean; forced: boolean }>(`
      SELECT n.nspname || '.' || c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
    const business = rows.filter((row) => !TECHNICAL_TABLES.includes(row.name));
    expect(business.length).toBeGreaterThanOrEqual(4);
    for (const table of business) expect(table, table.name).toMatchObject({ enabled: true, forced: true });
  });

  it("chaque table métier porte un tutor_space_id non nul (sauf la table des espaces elle-même) (R10)", async () => {
    const { rows } = await owner.query<{ name: string; has_space: boolean }>(`
      SELECT n.nspname || '.' || c.relname AS name,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tutor_space_id'
                       AND a.attnotnull AND NOT a.attisdropped) AS has_space
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
    const exempt = [...TECHNICAL_TABLES, "tenancy.tutor_spaces"];
    for (const table of rows.filter((row) => !exempt.includes(row.name)))
      expect(table, table.name).toMatchObject({ has_space: true });
  });

  it("le rôle d'exécution n'est ni propriétaire, ni superutilisateur, ni BYPASSRLS (R10)", async () => {
    const role = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ardoiz_user'",
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await owner.query(
      "SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'ardoiz_user'",
    );
    expect(owned.rowCount).toBe(0);
  });

  it("le rôle d'exécution n'a aucun droit sur la table de suivi des migrations (R10)", async () => {
    const pool = appPool();
    try {
      await expect(pool.query("SELECT * FROM public.schema_migrations")).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
    }
  });
});
