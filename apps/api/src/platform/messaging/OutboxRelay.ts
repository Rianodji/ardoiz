import type { Pool, PoolClient } from "pg";
import type { Clock } from "../../shared-kernel/Clock.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import { fromUuid, toUuid } from "../ids/UuidV7IdGenerator.js";
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

/**
 * Événement illisible pour un consommateur (champ manquant, inconnu ou mal formé) : le réessayer ne
 * servirait à rien. Il part directement dans la file des messages en échec.
 */
export class UnreadableEventError extends Error {
  readonly code = "unreadable-event";

  constructor(readonly field: string) {
    super(`Événement illisible (${field}).`);
  }
}

/** Essais au plus pour un même événement et un même consommateur, avant l'abandon (lettre morte). */
export const MAX_ATTEMPTS = 5;
/** Délai avant le deuxième essai ; il double ensuite (30 s, 1 min, 2 min, 4 min). */
export const FIRST_RETRY_DELAY_MS = 30_000;

interface OutboxRow {
  readonly id: string;
  readonly tutor_space_id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: Date;
}

interface FailureRow {
  readonly attempts: number;
  readonly dead: boolean;
  readonly next_attempt_at: Date;
  readonly resolved_at: Date | null;
}

/** Code d'erreur stable, jamais le message de l'exception (il pourrait contenir des données). */
function errorCode(error: unknown): string {
  if (error instanceof UnreadableEventError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(error.code) ? error.code : "error";
  }
  return error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "error";
}

/**
 * Relais de l'outbox vers les consommateurs du monolithe (ch. 5a du livre).
 *
 * - Les événements en attente sont réservés par `claim_pending_events` (identifiants seulement,
 *   `FOR UPDATE SKIP LOCKED` : deux relais ne livrent jamais le même lot en même temps).
 * - Chaque événement est relu et livré dans une transaction de SON espace, sous RLS (R10). Chaque
 *   consommateur travaille sous un point de sauvegarde : la réclamation dans l'inbox et ses effets
 *   sont validés ensemble, ou annulés ensemble sans toucher aux autres consommateurs.
 * - Un échec ne fait jamais planter le relais : il est compté dans `messaging.failed_events`, réessayé
 *   avec un délai croissant, puis abandonné au 5e essai ; un événement illisible est abandonné aussitôt.
 * - Un événement n'est marqué publié que lorsque chaque consommateur l'a traité ou abandonné.
 */
export class OutboxRelay {
  readonly #subscribers: EventSubscriber[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
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

  /** Livre un lot ; renvoie le nombre d'événements publiés (entièrement traités ou abandonnés). */
  async relayOnce(): Promise<number> {
    const claimer = await this.pool.connect();
    try {
      await claimer.query("BEGIN");
      const { rows } = await claimer.query<{ id: string; tutor_space_id: string }>(
        "SELECT id, tutor_space_id FROM messaging.claim_pending_events($1)",
        [this.batchSize],
      );
      const done: string[] = [];
      for (const row of rows) if (await this.#deliver(row.id, row.tutor_space_id)) done.push(row.id);
      if (done.length > 0) await claimer.query("SELECT messaging.mark_events_published($1::uuid[])", [done]);
      await claimer.query("COMMIT");
      return done.length;
    } catch (error) {
      await claimer.query("ROLLBACK").catch(() => undefined); // l'erreur d'origine est relancée ci-dessous
      throw error;
    } finally {
      claimer.release();
    }
  }

  /** Livre un événement à ses consommateurs ; vrai s'il n'y a plus rien à faire pour lui. */
  async #deliver(eventUuid: string, spaceUuid: string): Promise<boolean> {
    const tutorSpaceId = fromUuid("TutorSpaceId", spaceUuid);
    return withTenantTransaction(this.pool, tutorSpaceId, async (client) => {
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
      let complete = true;
      for (const subscriber of this.#subscribers.filter((s) => s.eventType === event.type)) {
        const failure = await this.#failure(client, subscriber.consumer, event);
        if (failure?.dead === true) continue; // abandonné : n'empêche plus la publication
        const now = this.clock.now();
        if (failure !== null && failure.resolved_at === null && failure.next_attempt_at > now) {
          complete = false; // délai d'attente avant le prochain essai
          continue;
        }
        await client.query("SAVEPOINT subscriber");
        try {
          if (await inbox.claim(subscriber.consumer, event)) await subscriber.handle(event, client);
          await client.query("RELEASE SAVEPOINT subscriber");
          if (failure !== null && failure.resolved_at === null)
            await this.#resolve(client, subscriber.consumer, event, now);
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT subscriber");
          const dead = await this.#recordFailure(client, subscriber.consumer, event, error, failure, now);
          if (!dead) complete = false;
        }
      }
      return complete;
    });
  }

  async #failure(client: PoolClient, consumer: string, event: IntegrationEvent): Promise<FailureRow | null> {
    const { rows } = await client.query<FailureRow>(
      `SELECT attempts, dead, next_attempt_at, resolved_at FROM messaging.failed_events
        WHERE tutor_space_id = $1 AND consumer = $2 AND event_id = $3`,
      [toUuid(event.tutorSpaceId), consumer, toUuid(event.id)],
    );
    return rows[0] ?? null;
  }

  /** Compte l'échec ; renvoie vrai si l'événement est abandonné pour ce consommateur. */
  async #recordFailure(
    client: PoolClient,
    consumer: string,
    event: IntegrationEvent,
    error: unknown,
    previous: FailureRow | null,
    now: Date,
  ): Promise<boolean> {
    const attempts = (previous?.attempts ?? 0) + 1;
    const dead = error instanceof UnreadableEventError || attempts >= MAX_ATTEMPTS;
    const next = new Date(now.getTime() + FIRST_RETRY_DELAY_MS * 2 ** (attempts - 1));
    await client.query(
      `INSERT INTO messaging.failed_events
         (tutor_space_id, consumer, event_id, event_type, attempts, error_code, dead, first_failed_at, last_failed_at, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
       ON CONFLICT (tutor_space_id, consumer, event_id) DO UPDATE
         SET attempts = EXCLUDED.attempts, error_code = EXCLUDED.error_code, dead = EXCLUDED.dead,
             last_failed_at = EXCLUDED.last_failed_at, next_attempt_at = EXCLUDED.next_attempt_at, resolved_at = NULL`,
      [
        toUuid(event.tutorSpaceId),
        consumer,
        toUuid(event.id),
        event.type,
        attempts,
        errorCode(error),
        dead,
        now,
        next,
      ],
    );
    return dead;
  }

  async #resolve(client: PoolClient, consumer: string, event: IntegrationEvent, now: Date): Promise<void> {
    await client.query(
      `UPDATE messaging.failed_events SET resolved_at = $4
        WHERE tutor_space_id = $1 AND consumer = $2 AND event_id = $3`,
      [toUuid(event.tutorSpaceId), consumer, toUuid(event.id), now],
    );
  }
}

/**
 * Boucle du relais dans le processus de l'application : un lot, puis un autre tant qu'il y a du
 * travail, sinon une pause. Une erreur est journalisée (code seulement) et la boucle continue.
 */
export class RelayLoop {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  #stopped = false;

  constructor(
    private readonly relay: OutboxRelay,
    private readonly onError: (code: string) => void,
    private readonly idleMs = 2_000,
  ) {}

  start(): void {
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#running;
  }

  #schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#running = this.#tick();
    }, delay);
  }

  async #tick(): Promise<void> {
    let delay = this.idleMs;
    try {
      if ((await this.relay.relayOnce()) > 0) delay = 0;
    } catch (error) {
      this.onError(errorCode(error));
    }
    this.#schedule(delay);
  }
}
