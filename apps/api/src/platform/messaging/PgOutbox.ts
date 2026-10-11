import type { PoolClient } from "pg";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import { toUuid } from "../ids/UuidV7IdGenerator.js";

/**
 * Écrit un événement d'intégration dans l'outbox, avec la connexion de la transaction métier :
 * l'événement est enregistré si, et seulement si, la modification métier l'est aussi.
 * La RLS refuse un événement d'un autre espace que celui de la transaction (R10).
 */
export async function appendToOutbox(client: PoolClient, event: IntegrationEvent): Promise<void> {
  await client.query(
    `INSERT INTO messaging.outbox (id, tutor_space_id, type, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      toUuid(event.id),
      toUuid(event.tutorSpaceId),
      event.type,
      JSON.stringify(event.payload),
      event.occurredAt,
    ],
  );
}
