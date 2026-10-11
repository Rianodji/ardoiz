import type { PoolClient } from "pg";
import type { Inbox, IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import { toUuid } from "../ids/UuidV7IdGenerator.js";

/**
 * Boîte de réception PostgreSQL. Elle utilise la connexion de la transaction du consommateur :
 * la réclamation et les effets du traitement sont validés, ou annulés, ensemble.
 */
export class PgInbox implements Inbox {
  constructor(private readonly client: PoolClient) {}

  async claim(consumer: string, event: IntegrationEvent): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO messaging.inbox (tutor_space_id, consumer, event_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [toUuid(event.tutorSpaceId), consumer, toUuid(event.id)],
    );
    return result.rowCount === 1;
  }
}
