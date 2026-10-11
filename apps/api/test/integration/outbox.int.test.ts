import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toUuid } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { appendToOutbox } from "../../src/platform/messaging/PgOutbox.js";
import { OutboxRelay, type EventSubscriber } from "../../src/platform/messaging/OutboxRelay.js";
import { PgInbox } from "../../src/platform/messaging/PgInbox.js";
import { withTenantTransaction } from "../../src/platform/postgres/withTenantTransaction.js";
import type { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import type { IntegrationEvent } from "../../src/shared-kernel/IntegrationEvent.js";
import { appPool, clock, createTutorSpace, ids } from "./database.js";

/** L'horloge avance d'une milliseconde par événement : l'ordre des UUIDv7, donc de livraison, est déterministe. */
const lessonCompleted = (space: TutorSpaceId): IntegrationEvent => {
  clock.advanceBy(1);
  return {
    id: ids.next("EventId"),
    type: "curriculum.lesson-completed",
    tutorSpaceId: space,
    occurredAt: clock.now(),
    payload: { learnerId: ids.next("LearnerId"), lessonId: ids.next("LessonId") },
  };
};

/**
 * Consommateur d'essai qui a un effet réel en base (une ligne d'audit par événement traité),
 * pour vérifier que l'effet n'est produit qu'une fois et dans l'espace de l'événement.
 */
class AuditingSubscriber implements EventSubscriber {
  readonly consumer = "test.auditing";
  readonly eventType = "curriculum.lesson-completed";
  failNext = false;
  readonly seen: string[] = [];

  async handle(event: IntegrationEvent, client: pg.PoolClient): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("panne simulée du consommateur");
    }
    this.seen.push(event.id);
    await client.query(
      `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, outcome)
       VALUES ($1, $2, $3, 'test.event-handled', 'system', 'success')`,
      [toUuid(ids.next("AuditEntryId")), toUuid(event.tutorSpaceId), clock.now()],
    );
  }
}

const handledCount = (pool: pg.Pool, space: TutorSpaceId) =>
  withTenantTransaction(pool, space, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'test.event-handled'",
    );
    return rows[0]?.n ?? -1;
  });

describe("Outbox transactionnelle, relais et inbox idempotente", () => {
  let pool: pg.Pool;
  let spaceA: TutorSpaceId;
  let spaceB: TutorSpaceId;
  let subscriber: AuditingSubscriber;
  let relay: OutboxRelay;

  beforeAll(async () => {
    pool = appPool();
    spaceA = await createTutorSpace(pool, "Espace outbox A");
    spaceB = await createTutorSpace(pool, "Espace outbox B");
  });
  beforeEach(async () => {
    subscriber = new AuditingSubscriber();
    relay = new OutboxRelay(pool);
    relay.subscribe(subscriber);
    while ((await relay.relayOnce()) > 0); // vide les événements des tests précédents
    subscriber.seen.length = 0;
  });
  afterAll(async () => {
    await pool.end();
  });

  it("n'enregistre l'événement que si la transaction métier est validée", async () => {
    const event = lessonCompleted(spaceA);
    await expect(
      withTenantTransaction(pool, spaceA, async (client) => {
        await appendToOutbox(client, event);
        throw new Error("échec métier après l'écriture");
      }),
    ).rejects.toThrow("échec métier");
    expect(await relay.relayOnce()).toBe(0);
    expect(subscriber.seen).toEqual([]);
  });

  it("livre chaque événement une fois, dans son espace, puis le marque publié", async () => {
    const [a, b] = [lessonCompleted(spaceA), lessonCompleted(spaceB)];
    await withTenantTransaction(pool, spaceA, (client) => appendToOutbox(client, a));
    await withTenantTransaction(pool, spaceB, (client) => appendToOutbox(client, b));
    const beforeA = await handledCount(pool, spaceA);
    const beforeB = await handledCount(pool, spaceB);

    expect(await relay.relayOnce()).toBe(2);
    expect(subscriber.seen).toEqual([a.id, b.id]);
    expect(await handledCount(pool, spaceA)).toBe(beforeA + 1);
    expect(await handledCount(pool, spaceB)).toBe(beforeB + 1);
    expect(await relay.relayOnce()).toBe(0);
  });

  it("refuse d'écrire dans l'outbox un événement d'un autre espace (R10)", async () => {
    await expect(
      withTenantTransaction(pool, spaceB, (client) => appendToOutbox(client, lessonCompleted(spaceA))),
    ).rejects.toThrow(/row-level security/);
  });

  it("reprend un lot après une panne du consommateur, sans doubler les effets déjà validés", async () => {
    const [first, second] = [lessonCompleted(spaceA), lessonCompleted(spaceA)];
    await withTenantTransaction(pool, spaceA, async (client) => {
      await appendToOutbox(client, first);
      await appendToOutbox(client, second);
    });
    const before = await handledCount(pool, spaceA);

    subscriber.seen.length = 0;
    const flaky = new AuditingSubscriber();
    const failingRelay = new OutboxRelay(pool);
    failingRelay.subscribe({
      consumer: subscriber.consumer,
      eventType: subscriber.eventType,
      handle: async (event, client) => {
        // Le premier événement est traité ; le second tombe en panne : tout le lot sera repris.
        if (event.id === second.id) flaky.failNext = true;
        await flaky.handle(event, client);
      },
    });
    await expect(failingRelay.relayOnce()).rejects.toThrow("panne simulée");
    expect(await handledCount(pool, spaceA)).toBe(before + 1);

    expect(await relay.relayOnce()).toBe(2);
    expect(subscriber.seen).toEqual([second.id]); // le premier était déjà dans l'inbox
    expect(await handledCount(pool, spaceA)).toBe(before + 2);
  });

  it("l'inbox ne réclame un même événement qu'une fois par consommateur", async () => {
    const event = lessonCompleted(spaceA);
    const claims = await withTenantTransaction(pool, spaceA, async (client) => {
      const inbox = new PgInbox(client);
      return [
        await inbox.claim("test.a", event),
        await inbox.claim("test.a", event),
        await inbox.claim("test.b", event),
      ];
    });
    expect(claims).toEqual([true, false, true]);
  });

  it("le rôle d'exécution ne lit pas le contenu de l'outbox d'un autre espace (R10)", async () => {
    const event = lessonCompleted(spaceA);
    await withTenantTransaction(pool, spaceA, (client) => appendToOutbox(client, event));
    const fromB = await withTenantTransaction(pool, spaceB, (client) =>
      client.query("SELECT payload FROM messaging.outbox WHERE id = $1", [toUuid(event.id)]),
    );
    expect(fromB.rowCount).toBe(0);
    await relay.relayOnce();
  });
});
