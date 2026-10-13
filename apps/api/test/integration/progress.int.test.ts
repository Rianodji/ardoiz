import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assign,
  createAssessment,
  loginGuardian,
  mcqTwelve,
  optionWithText,
  startAttempt,
  type LearnerAttempt,
} from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { setupProgramme, unlock, type Programme } from "./support/programme.js";
import { plannedSession } from "./support/scheduling.js";
import { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import { World, type Snapshot } from "./support/world.js";

interface Progress {
  xp: number;
  level: number;
  streak: { current: number; best: number; paused: boolean };
  badges: Array<{ badge: string }>;
  competencies: Array<{
    competencyId: string;
    code: string;
    level: string;
    evidenceCount: number;
    adjustment: unknown;
  }>;
  subjects: Array<{ name: string; average: number | null; grades: Array<{ grade: number }> }>;
}

describe("Progression (L6)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let programme: Programme;
  let competencyId: string;
  let attemptId: string;
  let world: World;

  /**
   * Lina termine un cours, rend un QCM juste avant l'échéance (publication automatique) et rejoint une
   * séance ; Noé termine le même cours. Les événements sont livrés par le relais, comme en production.
   */
  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    const tutor = family.tutor.cookie;
    programme = await setupProgramme(base, family);
    for (const learnerId of [family.learner.id, family.otherLearner.id]) {
      await unlock(
        base,
        tutor,
        { kind: "lesson", id: programme.lessonId },
        { kind: "learner", id: learnerId },
      );
    }
    for (const cookie of [family.learner.cookie, family.otherLearner.cookie]) {
      const done = await base.http({
        method: "POST",
        url: `/api/lessons/${programme.lessonId}/completion`,
        cookie,
      });
      expect(done.status).toBe(204);
    }
    const created = await createAssessment(base, tutor, "Arithmétique 1", ([c = ""]) => [mcqTwelve(c)]);
    competencyId = created.competencyIds[0] ?? "";
    const assignmentId = await assign(base, tutor, created.assessmentId, {
      learnerId: family.learner.id,
      publication: "auto",
    });
    const attempt = (await startAttempt(base, family.learner.cookie, assignmentId)).body as LearnerAttempt;
    attemptId = attempt.attemptId;
    await base.http({
      method: "POST",
      url: `/api/attempts/${attempt.attemptId}/submit`,
      cookie: family.learner.cookie,
      payload: {
        answers: {
          [attempt.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [optionWithText(attempt, 0, "12")] },
        },
      },
    });
    const session = await plannedSession(base, tutor, {
      learnerId: family.learner.id,
      date: "2026-10-12",
      time: "10:10",
      link: "https://meet.jit.si/ardoiz-progression",
    });
    const joined = await base.http({
      method: "POST",
      url: `/api/occurrences/${session.occurrences[0]?.occurrenceId ?? ""}/join`,
      cookie: family.learner.cookie,
    });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    await base.deliverEvents();
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

  const progressOf = async (cookie: string, learnerId = family.learner.id): Promise<Progress> => {
    const res = await world.http({ method: "GET", url: `/api/learners/${learnerId}/progress`, cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Progress;
  };

  it("points, compétence, badge, note et série sont tirés des événements (big picture §8)", async () => {
    const progress = await progressOf(family.learner.cookie);
    // Cours terminé 10 + copie rendue à temps 20 + question réussie 5 + compétence acquise 30 + présence 15.
    expect(progress.xp).toBe(80);
    expect(progress.level).toBe(0);
    expect(progress.badges.map((entry) => entry.badge)).toEqual(["first-step"]);
    expect(
      progress.competencies.find((competency) => competency.competencyId === competencyId),
    ).toMatchObject({
      level: "acquired",
      evidenceCount: 1,
    });
    expect(progress.subjects).toEqual([
      expect.objectContaining({
        name: "Mathématiques",
        average: 20,
        grades: [expect.objectContaining({ grade: 20 })],
      }),
    ]);
    expect(progress.streak).toEqual({ current: 1, best: 1, paused: false });
    expect((await progressOf(family.otherLearner.cookie, family.otherLearner.id)).xp).toBe(10);
  });

  it("rejouer deux fois chaque événement ne double ni les points ni les preuves (inbox + clés)", async () => {
    const before = await progressOf(family.learner.cookie);
    // Tout est rejoué : inbox du consommateur vidée et événements remis en attente.
    await world.adminQuery("DELETE FROM messaging.inbox WHERE consumer = 'progress'");
    await world.adminQuery("UPDATE messaging.outbox SET published_at = NULL");
    await world.deliverEvents();
    expect(await progressOf(family.learner.cookie)).toEqual(before);
    const evidences = await world.adminQuery<{ n: number }>(
      "SELECT count(*)::int AS n FROM progress.evidences",
    );
    expect(evidences[0]?.n).toBe(1);
  });

  it("deux tentatives rendues à temps sur une même attribution rapportent 20 points, pas 40 (verdict L6 S-3)", async () => {
    const before = (await progressOf(family.learner.cookie)).xp;
    const created = await createAssessment(world, family.tutor.cookie, "Arithmétique 2", ([c = ""]) => [
      mcqTwelve(c),
    ]);
    const assignmentId = await assign(world, family.tutor.cookie, created.assessmentId, {
      learnerId: family.learner.id,
      maxAttempts: 2,
    });
    for (let i = 0; i < 2; i++) {
      const attempt = (await startAttempt(world, family.learner.cookie, assignmentId)).body as LearnerAttempt;
      const submitted = await world.http({
        method: "POST",
        url: `/api/attempts/${attempt.attemptId}/submit`,
        cookie: family.learner.cookie,
        payload: { answers: {} },
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    }
    await world.deliverEvents();
    expect((await progressOf(family.learner.cookie)).xp).toBe(before + 20);
  });

  it("la reconstruction depuis les événements redonne exactement la même progression", async () => {
    const before = await progressOf(family.learner.cookie);
    const [space] = await world.adminQuery<{ id: string }>(
      "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
    );
    const result = await world.progress.rebuild(TutorSpaceId(`tsp_${space?.id ?? ""}`));
    expect(result.skipped).toBe(0);
    expect(await progressOf(family.learner.cookie)).toEqual(before);
  });

  it("un événement illisible part en file d'échec sans effet ni panne du relais (verdict L5 §6)", async () => {
    const [space] = await world.adminQuery<{ id: string }>(
      "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
    );
    await world.adminQuery(
      `INSERT INTO messaging.outbox (id, tutor_space_id, type, payload, occurred_at)
       VALUES ($3, $1, 'curriculum.lesson-completed', $2, now())`,
      [
        space?.id,
        JSON.stringify({
          learnerId: family.learner.id,
          lessonId: programme.lessonId,
          completedAt: "2026-10-12T08:00:00.000Z",
          subjectId: null,
          xp: 1000,
        }),
        world.ids.next("EventId").slice(4),
      ],
    );
    await world.deliverEvents();
    const failed = await world.adminQuery<{ dead: boolean; error_code: string }>(
      "SELECT dead, error_code FROM messaging.failed_events WHERE consumer = 'progress'",
    );
    expect(failed).toEqual([{ dead: true, error_code: "unreadable-event" }]);
    expect((await progressOf(family.learner.cookie)).xp).toBe(80);
  });

  it("l'ajustement du tuteur exige une justification, est audité, et prime jusqu'à la preuve suivante", async () => {
    const url = `/api/learners/${family.learner.id}/competencies/${competencyId}/level`;
    const short = await world.http({
      method: "PUT",
      url,
      cookie: family.tutor.cookie,
      payload: { level: "in_progress", justification: "non" },
    });
    expect(short.body).toMatchObject({ code: "progress.invalid-justification" });
    const adjusted = await world.http({
      method: "PUT",
      url,
      cookie: family.tutor.cookie,
      payload: { level: "in_progress", justification: "Réussi par chance, à revoir en séance." },
    });
    expect(adjusted.status).toBe(204);
    const progress = await progressOf(family.linkedGuardian);
    expect(
      progress.competencies.find((competency) => competency.competencyId === competencyId),
    ).toMatchObject({
      level: "in_progress",
      adjustment: { justification: "Réussi par chance, à revoir en séance." },
    });
    const audit = await world.adminQuery<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'progress.competency-adjusted'",
    );
    expect(audit[0]?.n).toBe(1);
    // Une note rectifiée (nouvelle preuve plus tard) : le niveau calculé reprend la main ; aucun point retiré.
    world.clock.advanceBy(60_000);
    await world.http({
      method: "POST",
      url: `/api/grading/attempts/${attemptId}/rectifications`,
      cookie: family.tutor.cookie,
      payload: {
        questionId: (
          await world.adminQuery<{ id: string }>("SELECT 'qst_' || id AS id FROM assessment.questions")
        )[0]?.id,
        earned: 0,
        reason: "Erreur de saisie de la note.",
      },
    });
    await world.deliverEvents();
    const after = await progressOf(family.learner.cookie);
    expect(after.subjects[0]?.average).toBe(0);
    expect(after.xp).toBe(80); // jamais de pénalité (R17)
  });

  it("aucune réponse destinée à un élève ou à un parent ne contient de classement ni de données d'un autre élève (R17, R2)", async () => {
    const awa = await loginGuardian(world, "awa@example.org");
    const ids: Record<string, string> = {
      learnerId: family.learner.id,
      lessonId: programme.lessonId,
      attemptId,
      competencyId,
    };
    const routes = world.routes.filter((route) => route.method === "GET" && route.url.startsWith("/api/"));
    const bodies: string[] = [];
    for (const cookie of [family.learner.cookie, awa]) {
      for (const route of routes) {
        for (const learnerId of [family.learner.id, family.otherLearner.id]) {
          const url = route.url.replace(/:(\w+)/g, (_, name: string) =>
            name === "learnerId" ? learnerId : (ids[name] ?? "inconnu"),
          );
          const res = await world.http({ method: "GET", url, cookie });
          if (res.status === 200) bodies.push(JSON.stringify(res.body));
        }
      }
    }
    const everything = bodies.join("\n");
    expect(everything).not.toContain(family.otherLearner.id);
    expect(everything).not.toContain("Noé");
    for (const key of ["rank", "ranking", "leaderboard", "percentile", "classement", "groupAverage"]) {
      expect(everything).not.toContain(`"${key}"`);
    }
    // La synthèse par élève et par groupe est réservée au tuteur.
    for (const cookie of [family.learner.cookie, awa]) {
      expect((await world.http({ method: "GET", url: "/api/progress/overview", cookie })).status).toBe(403);
    }
    const overview = (
      await world.http({ method: "GET", url: "/api/progress/overview", cookie: family.tutor.cookie })
    ).body as {
      learners: Array<{ learnerId: string; xp: number }>;
    };
    expect(overview.learners.map((entry) => [entry.learnerId, entry.xp]).sort()).toEqual(
      [
        [family.learner.id, 80],
        [family.otherLearner.id, 10],
      ].sort(),
    );
  });
});
