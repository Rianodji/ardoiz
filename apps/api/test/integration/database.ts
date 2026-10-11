import pg from "pg";
import { inject } from "vitest";
import { UuidV7IdGenerator, toUuid } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../src/platform/postgres/withTenantTransaction.js";
import type { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import { FixedClock } from "../support/clock.js";

export const clock = new FixedClock(new Date("2026-10-11T08:00:00Z"));
export const ids = new UuidV7IdGenerator(clock);

/** Pool du rôle d'exécution, soumis à la RLS : celui de l'application. */
export const appPool = (): pg.Pool => new pg.Pool({ connectionString: inject("appUrl"), max: 4 });
/** Connexion du rôle propriétaire : celui des migrations. */
export const ownerClient = async (): Promise<pg.Client> => {
  const client = new pg.Client({ connectionString: inject("ownerUrl") });
  await client.connect();
  return client;
};

/** Crée un espace tuteur, par le seul chemin autorisé : une transaction déclarée dans cet espace. */
export async function createTutorSpace(pool: pg.Pool, name: string): Promise<TutorSpaceId> {
  const id = ids.next("TutorSpaceId");
  await withTenantTransaction(pool, id, (client) =>
    client.query("INSERT INTO tenancy.tutor_spaces (id, name, created_at) VALUES ($1, $2, $3)", [
      toUuid(id),
      name,
      clock.now(),
    ]),
  );
  return id;
}
