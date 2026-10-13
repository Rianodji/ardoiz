import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginGuardian, loginLearner, loginTutor } from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { planSession, plannedSession, type TutorSession } from "./support/scheduling.js";
import { World, type HttpResult, type Snapshot } from "./support/world.js";

/** Mercredi 14 octobre 2026, 14 h à Paris = 12 h UTC (heure d'été). */
const START = new Date("2026-10-14T12:00:00Z");
const at = (seconds: number) => new Date(START.getTime() + seconds * 1000);

describe("Planification (L5)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let session: TutorSession;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    session = await plannedSession(base, family.tutor.cookie, {
      learnerId: family.learner.id,
      date: "2026-10-14",
      time: "14:00",
      durationMinutes: 60,
      link: "https://meet.jit.si/ardoiz-seance-de-lina",
    });
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

  const tutor = () => family.tutor.cookie;
  const occurrenceId = () => session.occurrences[0]?.occurrenceId ?? "";
  const join = (cookie: string, id = occurrenceId()): Promise<HttpResult> =>
    world.http({ method: "POST", url: `/api/occurrences/${id}/join`, cookie });
  const view = (cookie: string, id = occurrenceId()): Promise<HttpResult> =>
    world.http({ method: "GET", url: `/api/occurrences/${id}`, cookie });
  /** L'horloge du serveur avance ; l'élève se reconnecte (sessions expirées, R8). */
  const learnerAt = async (instant: Date) => {
    world.clock.setTo(instant);
    return loginLearner(world, "lina");
  };

  describe("Rejoindre et lien de visio (R9)", () => {
    it("bornes : T − 15 min − 1 s refusé, T − 15 min accepté, fin − 1 s accepté, fin + 0 s refusé (R9)", async () => {
      for (const [seconds, status] of [
        [-15 * 60 - 1, 409],
        [-15 * 60, 200],
        [3600 - 1, 200],
        [3600, 409],
      ] as const) {
        const res = await join(await learnerAt(at(seconds)));
        expect(res.status, `T + ${String(seconds)} s`).toBe(status);
        if (status === 409) expect(res.body).toMatchObject({ code: "scheduling.link-not-available" });
        else expect(res.body).toEqual({ meetingLink: "https://meet.jit.si/ardoiz-seance-de-lina" });
      }
    });

    it("la présence n'est notée qu'en rejoignant, une seule fois, avec l'événement SéanceRejointe (L6)", async () => {
      const cookie = await learnerAt(at(-60));
      // Consulter la séance, même avec le lien affiché, ne vaut pas présence.
      expect((await view(cookie)).body).toMatchObject({
        meetingLink: "https://meet.jit.si/ardoiz-seance-de-lina",
      });
      const count = async (sql: string) => (await world.adminQuery<{ n: number }>(sql))[0]?.n;
      expect(await count("SELECT count(*)::int AS n FROM scheduling.session_attendance")).toBe(0);
      expect((await join(cookie)).status).toBe(200);
      expect((await join(cookie)).status).toBe(200);
      expect(await count("SELECT count(*)::int AS n FROM scheduling.session_attendance")).toBe(1);
      const events = await world.adminQuery<{ payload: { learnerId: string } }>(
        "SELECT payload FROM messaging.outbox WHERE type = 'scheduling.session-joined'",
      );
      expect(events.map((event) => event.payload.learnerId)).toEqual([family.learner.id]);
      await expect(world.adminQuery("DELETE FROM scheduling.session_attendance")).rejects.toThrow(
        /ajout seul/,
      );
    });

    it("le tuteur obtient toujours le lien, sans présence notée ; le parent lié jamais (🚫)", async () => {
      world.clock.setTo(at(-3 * 3600));
      const tutorCookie = await loginTutor(world, family);
      expect((await join(tutorCookie)).body).toEqual({
        meetingLink: "https://meet.jit.si/ardoiz-seance-de-lina",
      });
      expect((await view(tutorCookie)).body).toMatchObject({
        meetingLink: "https://meet.jit.si/ardoiz-seance-de-lina",
      });
      world.clock.setTo(at(60));
      const guardian = await loginGuardian(world, "awa@example.org");
      expect((await join(guardian)).status).toBe(403);
      const seen = await view(guardian);
      expect(seen.body).toMatchObject({
        meetingLink: null,
        participantIds: [family.learner.id],
      });
      const rows = await world.adminQuery<{ n: number }>(
        "SELECT count(*)::int AS n FROM scheduling.session_attendance",
      );
      expect(rows[0]?.n).toBe(0);
    });

    it("changer le lien (régénération après une fuite) : l'ancien n'est plus servi (M10)", async () => {
      expect(
        (
          await world.http({
            method: "PUT",
            url: `/api/sessions/${session.id}/link`,
            cookie: tutor(),
            payload: {},
          })
        ).status,
      ).toBe(204);
      const cookie = await learnerAt(at(0));
      const link = ((await join(cookie)).body as { meetingLink: string }).meetingLink;
      expect(link).toMatch(/^https:\/\/meet\.jit\.si\/ardoiz-[A-Za-z0-9_-]{24}$/);
      expect(link).not.toBe("https://meet.jit.si/ardoiz-seance-de-lina");
      const bad = await world.http({
        method: "PUT",
        url: `/api/sessions/${session.id}/link`,
        cookie: await loginTutor(world, family),
        payload: { link: "https://meet.jit.si.evil.example/x" },
      });
      expect(bad.body).toMatchObject({ code: "scheduling.invalid-link" });
    });
  });

  describe("Lien relu en base (verdict L5, S-1)", () => {
    it("un lien altéré en base n'est servi à personne : 409 au clic, absent de la séance, « à remplacer » pour le tuteur (R9)", async () => {
      await world.adminQuery(
        "UPDATE scheduling.tutoring_sessions SET meeting_link = 'https://evil.example/' WHERE id = $1",
        [session.id.slice(4)],
      );
      const cookie = await learnerAt(at(0));
      const joined = await join(cookie);
      expect(joined.status).toBe(409);
      expect(joined.body).toMatchObject({ code: "scheduling.link-to-replace" });
      expect(JSON.stringify(joined.body)).not.toContain("evil.example");
      expect((await view(cookie)).body).toMatchObject({ meetingLink: null });
      const tutorCookie = await loginTutor(world, family);
      expect((await join(tutorCookie)).status).toBe(409);
      const list = (await world.http({ method: "GET", url: "/api/sessions", cookie: tutorCookie })).body as {
        sessions: Array<{ id: string; linkToReplace: boolean }>;
      };
      expect(list.sessions.find((candidate) => candidate.id === session.id)?.linkToReplace).toBe(true);
      // Remplacer le lien le remet en service.
      await world.http({
        method: "PUT",
        url: `/api/sessions/${session.id}/link`,
        cookie: tutorCookie,
        payload: {},
      });
      expect((await join(cookie)).status).toBe(200);
    });
  });

  describe("Agenda (R9)", () => {
    it("l'agenda ne contient jamais le lien, même dans la fenêtre ; chacun ne voit que ses séances (R2, R9)", async () => {
      const cookie = await learnerAt(at(0));
      const agenda = (cookie: string) =>
        world.http({ method: "GET", url: "/api/agenda?from=2026-10-12&days=7", cookie });
      const mine = await agenda(cookie);
      expect(mine.body).toMatchObject({
        occurrences: [{ title: "Séance de mathématiques", meetingLink: null, participantIds: [] }],
      });
      expect(JSON.stringify(mine.body)).not.toContain("meet.jit.si");
      const noe = await loginLearner(world, "noe");
      expect((await agenda(noe)).body).toEqual({ occurrences: [] });
      const bintou = await loginGuardian(world, "bintou@example.org");
      expect((await agenda(bintou)).body).toEqual({ occurrences: [] });
      const awa = await loginGuardian(world, "awa@example.org");
      expect((await agenda(awa)).body).toMatchObject({
        occurrences: [{ participantIds: [family.learner.id], meetingLink: null }],
      });
    });

    it("une séance hebdomadaire à 14 h reste à 14 h heure de Paris après le passage à l'heure d'hiver (H8)", async () => {
      const weekly = await plannedSession(world, tutor(), {
        learnerId: family.learner.id,
        kind: "weekly",
        date: "2026-10-21",
        time: "14:00",
        until: "2026-11-04",
      });
      expect(weekly.occurrences.map((occurrence) => [occurrence.startsAt, occurrence.local.start])).toEqual([
        ["2026-10-21T12:00:00.000Z", "14:00"],
        ["2026-10-28T13:00:00.000Z", "14:00"],
        ["2026-11-04T13:00:00.000Z", "14:00"],
      ]);
    });

    it("une séance pour un groupe concerne ses élèves au moment de la planification", async () => {
      const group = await world.http({
        method: "POST",
        url: "/api/groups",
        cookie: tutor(),
        payload: { name: "Cousins" },
      });
      const groupId = (group.body as { id: string }).id;
      await world.http({
        method: "PUT",
        url: `/api/groups/${groupId}/members`,
        cookie: tutor(),
        payload: { learnerIds: [family.learner.id, family.otherLearner.id] },
      });
      const planned = await plannedSession(world, tutor(), { groupId, date: "2026-10-15", time: "10:00" });
      const noe = await loginLearner(world, "noe");
      expect((await view(noe, planned.occurrences[0]?.occurrenceId)).status).toBe(200);
    });
  });

  describe("Déplacer, annuler, refuser", () => {
    it("on ne planifie pas dans le passé, ni pour un compte qui n'est pas un élève de l'espace (R2)", async () => {
      const past = await planSession(world, tutor(), {
        learnerId: family.learner.id,
        date: "2026-10-12",
        time: "09:00",
      });
      expect(past.body).toMatchObject({ code: "scheduling.in-the-past" });
      const [guardian] = await world.adminQuery<{ id: string }>(
        "SELECT id FROM identity.accounts WHERE role = 'guardian' LIMIT 1",
      );
      const notALearner = await planSession(world, tutor(), {
        learnerId: `lrn_${guardian?.id ?? ""}`,
        date: "2026-10-20",
        time: "09:00",
      });
      expect(notALearner.status).toBe(404);
    });

    it("déplacer une séance la marque déplacée et décale la fenêtre du lien (R9)", async () => {
      const moved = await world.http({
        method: "PATCH",
        url: `/api/occurrences/${occurrenceId()}`,
        cookie: tutor(),
        payload: { date: "2026-10-15", time: "17:30", durationMinutes: 45 },
      });
      expect(moved.status).toBe(204);
      const cookie = await learnerAt(at(0));
      expect((await view(cookie)).body).toMatchObject({
        moved: true,
        local: { date: "2026-10-15", start: "17:30", end: "18:15" },
        meetingLink: null,
      });
      expect((await join(cookie)).status).toBe(409);
      const backwards = await world.http({
        method: "PATCH",
        url: `/api/occurrences/${occurrenceId()}`,
        cookie: await loginTutor(world, family),
        payload: { date: "2026-10-13", time: "09:00", durationMinutes: 45 },
      });
      expect(backwards.body).toMatchObject({ code: "scheduling.in-the-past" });
    });

    it("une séance annulée ne révèle plus de lien, ne se rejoint plus et ne change plus, même en SQL", async () => {
      expect(
        (
          await world.http({
            method: "POST",
            url: `/api/occurrences/${occurrenceId()}/cancel`,
            cookie: tutor(),
            payload: { wholeSeries: false },
          })
        ).status,
      ).toBe(204);
      const cookie = await learnerAt(at(60));
      expect((await view(cookie)).body).toMatchObject({ status: "cancelled", meetingLink: null });
      expect((await join(cookie)).body).toMatchObject({ code: "scheduling.cancelled" });
      const id = occurrenceId().slice(4);
      await expect(
        world.adminQuery("UPDATE scheduling.session_occurrences SET cancelled_at = NULL WHERE id = $1", [id]),
      ).rejects.toThrow(/annulée/);
      await expect(
        world.adminQuery("DELETE FROM scheduling.session_occurrences WHERE id = $1", [id]),
      ).rejects.toThrow(/s'annule/);
    });

    it("annuler la suite d'une série annule les occurrences à venir à partir de celle-ci", async () => {
      const weekly = await plannedSession(world, tutor(), {
        learnerId: family.learner.id,
        kind: "weekly",
        date: "2026-10-20",
        time: "17:00",
        until: "2026-11-10",
      });
      const second = weekly.occurrences[1]?.occurrenceId ?? "";
      await world.http({
        method: "POST",
        url: `/api/occurrences/${second}/cancel`,
        cookie: tutor(),
        payload: { wholeSeries: true },
      });
      const after = (await world.http({ method: "GET", url: "/api/sessions", cookie: tutor() })).body as {
        sessions: TutorSession[];
      };
      const statuses = after.sessions
        .find((candidate) => candidate.id === weekly.id)
        ?.occurrences.map((occurrence) => occurrence.status);
      expect(statuses).toEqual(["scheduled", "cancelled", "cancelled", "cancelled"]);
      const audit = await world.adminQuery<{ action: string }>(
        "SELECT action FROM audit.audit_log WHERE action LIKE 'scheduling.%' ORDER BY occurred_at",
      );
      expect(audit.map((entry) => entry.action)).toContain("scheduling.series-cancelled");
    });
  });
});
