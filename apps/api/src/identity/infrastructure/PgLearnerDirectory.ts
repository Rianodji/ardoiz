import type { Pool } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";

/**
 * Annuaire des élèves offert aux autres modules (règle 12) : ils vérifient qu'un identifiant désigne
 * bien un ÉLÈVE de l'espace sans lire eux-mêmes les tables d'identity. Ne renvoie que des identifiants.
 */
export class PgLearnerDirectory {
  constructor(private readonly pool: Pool) {}

  async existingLearners(tutorSpaceId: TutorSpaceId, learnerIds: readonly LearnerId[]): Promise<LearnerId[]> {
    if (learnerIds.length === 0) return [];
    return withTenantTransaction(this.pool, tutorSpaceId, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM identity.accounts WHERE id = ANY($1::uuid[]) AND role = 'learner' ORDER BY id`,
        [learnerIds.map(toUuid)],
      );
      return result.rows.map((row) => fromUuid("LearnerId", row.id));
    });
  }
}
