import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginGuardian } from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { World, type Snapshot } from "./support/world.js";

describe("Suggestions des parents (L6, big picture §7)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    snapshot = await base.freeze();
  });
  afterAll(async () => {
    await World.drop(snapshot.database);
  });
  beforeEach(async () => {
    world = await snapshot.fork();
  });
  afterEach(async () => {
    await world.close();
  });

  const send = (cookie: string, body: string, category = "lessons") =>
    world.http({ method: "POST", url: "/api/suggestions", cookie, payload: { category, body } });
  const list = async (cookie: string) =>
    (
      (await world.http({ method: "GET", url: "/api/suggestions", cookie })).body as {
        suggestions: Array<{ id: string; body: string; status: string; reply: string | null }>;
      }
    ).suggestions;

  it("le texte est gardé tel quel, comme du texte brut ; 2 000 caractères au plus (R4, R15)", async () => {
    const payload = 'Merci ! <img src=x onerror="alert(1)"> Une séance de plus ?';
    expect((await send(family.linkedGuardian, payload)).status).toBe(201);
    expect((await list(family.linkedGuardian))[0]?.body).toBe(payload);
    expect((await send(family.linkedGuardian, "x".repeat(2001))).status).toBe(400);
    expect((await send(family.linkedGuardian, "a\u0000b")).body).toMatchObject({
      code: "feedback.invalid-body",
    });
  });

  it("au plus 5 suggestions par jour et par parent, puis 429 avec Retry-After (R15)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await send(family.linkedGuardian, `Idée ${String(i)}`)).status).toBe(201);
      world.clock.advanceBy(60_000);
    }
    const sixth = await send(family.linkedGuardian, "Une de trop");
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers["retry-after"])).toBe(24 * 3600 - 5 * 60);
    // Le quota est par parent : Bintou n'est pas gênée.
    expect((await send(family.unlinkedGuardian, "Bonjour")).status).toBe(201);
    world.clock.advanceBy(24 * 3_600_000);
    // La session a expiré entre-temps (durée absolue de 12 h, R8) : le parent se reconnecte.
    expect((await send(await loginGuardian(world, "awa@example.org"), "Le lendemain")).status).toBe(201);
  });

  it("le tuteur lit, marque traitée et répond ; le parent voit le statut et la réponse, et seulement ses suggestions", async () => {
    await send(family.linkedGuardian, "Plus d'exercices de géométrie ?");
    await send(family.unlinkedGuardian, "Merci pour le cours");
    const forTutor = await list(family.tutor.cookie);
    expect(forTutor).toHaveLength(2);
    const target = forTutor.find((entry) => entry.body.startsWith("Plus"));
    const handled = await world.http({
      method: "PATCH",
      url: `/api/suggestions/${target?.id ?? ""}`,
      cookie: family.tutor.cookie,
      payload: { status: "done", reply: "Oui, dès la semaine prochaine." },
    });
    expect(handled.status).toBe(204);
    const mine = await list(family.linkedGuardian);
    expect(mine).toEqual([
      expect.objectContaining({ status: "done", reply: "Oui, dès la semaine prochaine." }),
    ]);
    // Une suggestion d'un autre parent : 👻 ; un élève ne voit aucune suggestion : 🚫.
    expect(
      (
        await world.http({
          method: "GET",
          url: `/api/suggestions/${target?.id ?? ""}`,
          cookie: family.unlinkedGuardian,
        })
      ).status,
    ).toBe(404);
    expect(
      (await world.http({ method: "GET", url: "/api/suggestions", cookie: family.learner.cookie })).status,
    ).toBe(403);
    // Le texte ne change jamais, même en SQL direct.
    await expect(world.adminQuery("UPDATE feedback.suggestions SET body = 'modifié'")).rejects.toThrow(
      /ne change pas/,
    );
  });
});
