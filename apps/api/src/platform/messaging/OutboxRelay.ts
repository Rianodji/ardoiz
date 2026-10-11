import type { Pool, PoolClient } from "pg";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import { fromUuid } from "../ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../postgres/withTenantTransaction.js";
import { PgInbox } from "./PgInbox.js";

/**
 * Consommateur d'un type d'événement. Il reçoit la connexion de la transaction de l'espace
 * de l'événement, dans laquelle il doit faire tous ses effets.
 */
export interface EventSubscriber {
  readonly consumer: string;
  readonly eventType: string;
  handle(event: IntegrationEvent, client: PoolClient): Promise<void>;
}

interface OutboxRow {
  readonly id: string;
  readonly tutor_space_id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: Date;
}

/**
 * Relais de l'outbox vers les consommateurs du monolithe (ch. 5a du livre).
 *
 * - Les événements en attente sont réservés par `claim_pending_events` (identifiants seulement,
 *   `FOR UPDATE SKIP LOCKED` : deux relais ne livrent jamais le même lot en même temps).
 * - Chaque événement est relu et livré dans une transaction de SON espace, sous RLS (R10) ;
 *   la réclamation dans l'inbox et les effets du consommateur sont validés ensemble.
 * - Livraison « au moins une fois » : si une livraison échoue, le lot entier est repris plus tard ;
 *   l'inbox rend la répétition sans effet.
 */
export class OutboxRelay {
  readonly #subscribers: EventSubscriber[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly batchSize = 100,
  ) {}

  subscribe(subscriber: EventSubscriber): void {
    const duplicate = this.#subscribers.some(
      (s) => s.consumer === subscriber.consumer && s.eventType === subscriber.eventType,
    );
    if (duplicate)
      throw new Error(`Consommateur déjà abonné : ${subscriber.consumer} / ${subscriber.eventType}`);
    this.#subscribers.push(subscriber);
  }

  /** Livre un lot ; renvoie le nombre d'événements publiés. Une erreur annule tout le lot. */
  async relayOnce(): Promise<number> {
    const claimer = await this.pool.connect();
    try {
      await claimer.query("BEGIN");
      const { rows } = await claimer.query<{ id: string; tutor_space_id: string }>(
        "SELECT id, tutor_space_id FROM messaging.claim_pending_events($1)",
        [this.batchSize],
      );
      for (const row of rows) await this.#deliver(row.id, row.tutor_space_id);
      if (rows.length > 0) {
        await claimer.query("SELECT messaging.mark_events_published($1::uuid[])", [
          rows.map((row) => row.id),
        ]);
      }
      await claimer.query("COMMIT");
      return rows.length;
    } catch (error) {
      await claimer.query("ROLLBACK").catch(() => undefined); // l'erreur d'origine est relancée ci-dessous
      throw error;
    } finally {
      claimer.release();
    }
  }

  async #deliver(eventUuid: string, spaceUuid: string): Promise<void> {
    const tutorSpaceId = fromUuid("TutorSpaceId", spaceUuid);
    await withTenantTransaction(this.pool, tutorSpaceId, async (client) => {
      const { rows } = await client.query<OutboxRow>(
        "SELECT id, tutor_space_id, type, payload, occurred_at FROM messaging.outbox WHERE id = $1",
        [eventUuid],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("Événement réservé introuvable dans son espace.");
      const event: IntegrationEvent = {
        id: fromUuid("EventId", row.id),
        tutorSpaceId,
        type: row.type,
        occurredAt: row.occurred_at,
        payload: row.payload,
      };
      const inbox = new PgInbox(client);
      for (const subscriber of this.#subscribers.filter((s) => s.eventType === event.type)) {
        if (await inbox.claim(subscriber.consumer, event)) await subscriber.handle(event, client);
      }
    });
  }
}
