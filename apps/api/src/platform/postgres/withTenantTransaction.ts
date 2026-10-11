import type { Pool, PoolClient } from "pg";
import type { TutorSpaceId } from "../../shared-kernel/ids.js";
import { toUuid } from "../ids/UuidV7IdGenerator.js";

/**
 * Ouvre une transaction et y déclare l'espace tuteur courant pour la RLS (R10, ADR-0002).
 * `set_config(…, true)` limite la valeur à la transaction : une connexion rendue au pool
 * ne transporte jamais l'espace d'une requête précédente. Sans cet appel, la RLS ne laisse
 * voir aucune ligne (échec en mode fermé).
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  tutorSpaceId: TutorSpaceId,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tutor_space_id', $1, true)", [toUuid(tutorSpaceId)]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); // l'erreur d'origine est relancée ci-dessous
    throw error;
  } finally {
    client.release();
  }
}
