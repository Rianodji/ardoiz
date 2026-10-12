import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assign,
  createAssessment,
  FRIDAY_18H,
  loginGuardian,
  loginLearner,
  mcqTwelve,
  optionWithText,
  startAttempt,
  type LearnerAttempt,
  type QuestionPayload,
} from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { World, type HttpResult, type Snapshot } from "./support/world.js";

/** Valeurs témoins : si l'une d'elles apparaît dans une réponse reçue par l'élève, la réponse attendue a fui (R5). */
const SENTINELS = ["4217.5", "4217,5", "0.37", "TEMOIN-CORRIGE", "TEMOIN-MODELE", "TEMOIN-EXPLICATION"];
const FORBIDDEN_KEYS = [
  "correct",
  "correctOptions",
  "correctOptionIds",
  "expected",
  "tolerance",
  "unitMode",
  "modelAnswer",
  "explanation",
  "spec",
  "earned",
];

/** Épreuve mixte : QCM (bonne réponse « 12 »), numérique (4217,5 cm à 0,37 près, unité libre), réponse courte. */
const mixedQuestions = ([c1 = "", c2 = ""]: readonly string[]): QuestionPayload[] => [
  { ...mcqTwelve(c1), explanation: "TEMOIN-EXPLICATION" },
  {
    kind: "numeric",
    prompt: "Longueur de la piste, en cm ?",
    points: 3,
    competencyIds: [c2],
    expected: "4217.5",
    tolerance: "0.37",
    unit: "cm",
    unitMode: "free",
    explanation: "TEMOIN-CORRIGE",
  },
  {
    kind: "short_text",
    prompt: "Explique ta méthode.",
    points: 5,
    competencyIds: [c1, c2],
    modelAnswer: "TEMOIN-MODELE",
  },
];

function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value !== null && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      keysOf(item, into);
    }
  return into;
}

/** Vérifie qu'aucune réponse attendue ne figure dans un corps JSON reçu par l'élève ou son parent (R5). */
function expectNoExpectedAnswer(where: string, body: unknown): void {
  const text = JSON.stringify(body ?? null);
  for (const sentinel of SENTINELS) expect(text, `${where} contient ${sentinel}`).not.toContain(sentinel);
  // Les identifiants d'origine des options (o1, o2…) trahiraient leur position, donc la bonne réponse.
  expect(text, where).not.toMatch(/"o\d"/);
  const keys = keysOf(body);
  for (const key of FORBIDDEN_KEYS) expect(keys, `${where} : clé ${key}`).not.toContain(key);
}

describe("Évaluation (L3)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let mixedId: string;
  let qcmId: string;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    mixedId = (await createAssessment(base, family.tutor.cookie, "Contrôle mixte", mixedQuestions))
      .assessmentId;
    qcmId = (
      await createAssessment(base, family.tutor.cookie, "Arithmétique 1", ([c = ""]) => [mcqTwelve(c)])
    ).assessmentId;
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
  const lina = () => family.learner.cookie;
  const call = (
    method: "GET" | "POST" | "PUT",
    url: string,
    cookie: string,
    payload?: object,
  ): Promise<HttpResult> =>
    world.http({ method, url, cookie, ...(payload === undefined ? {} : { payload }) });
  const start = async (cookie: string, assignmentId: string): Promise<LearnerAttempt> => {
    const res = await startAttempt(world, cookie, assignmentId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as LearnerAttempt;
  };
  const submit = (cookie: string, attemptId: string, answers?: object) =>
    call("POST", `/api/attempts/${attemptId}/submit`, cookie, answers === undefined ? {} : { answers });
  const mixedAnswers = (attempt: LearnerAttempt, numeric = { value: "42,175", unit: "m" }) => ({
    [attempt.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [optionWithText(attempt, 0, "12")] },
    [attempt.questions[1]?.id ?? ""]: { kind: "numeric", ...numeric },
    [attempt.questions[2]?.id ?? ""]: { kind: "short_text", text: "J'ai converti en mètres." },
  });

  describe("Réponses attendues protégées (R5, ADR-0007)", () => {
    it("aucune réponse attendue dans AUCUN JSON reçu par l'élève ou son parent avant publication, sur toutes les routes de lecture (R5)", async () => {
      const assignmentId = await assign(world, tutor(), mixedId, {
        learnerId: family.learner.id,
        publication: "manual",
      });
      const seen: Array<[string, unknown]> = [];
      const record = (where: string, res: HttpResult) => {
        seen.push([where, res.body]);
        return res;
      };
      const attempt = record("commencer", await startAttempt(world, lina(), assignmentId))
        .body as LearnerAttempt;
      expect(
        record(
          "brouillon",
          await call("PUT", `/api/attempts/${attempt.attemptId}/answers`, lina(), {
            answers: mixedAnswers(attempt),
          }),
        ).status,
      ).toBe(204);
      record("revoir le brouillon", await call("GET", `/api/attempts/${attempt.attemptId}`, lina()));
      record("rendre", await submit(lina(), attempt.attemptId));

      // Toutes les routes GET de l'API, paramètres remplacés par les identifiants connus, pour l'élève et son parent.
      const ids: Record<string, string> = {
        attemptId: attempt.attemptId,
        assignmentId,
        assessmentId: mixedId,
        learnerId: family.learner.id,
      };
      const getRoutes = world.routes.filter(
        (route) => route.method === "GET" && route.url.startsWith("/api/"),
      );
      expect(getRoutes.length).toBeGreaterThan(15);
      for (const cookie of [lina(), family.linkedGuardian]) {
        for (const route of getRoutes) {
          const url = route.url.replace(/:(\w+)/g, (_, name: string) => ids[name] ?? "inconnu");
          record(`GET ${url}`, await call("GET", url, cookie));
        }
      }
      for (const [where, body] of seen) expectNoExpectedAnswer(where, body);

      // Témoin du test lui-même : après publication, le corrigé apparaît et le détecteur le voit.
      await call("POST", `/api/grading/attempts/${attempt.attemptId}/grades`, tutor(), {
        grades: [{ questionId: attempt.questions[2]?.id, earned: 5 }],
      });
      expect((await call("POST", `/api/grading/attempts/${attempt.attemptId}/publish`, tutor())).status).toBe(
        204,
      );
      const published = JSON.stringify(
        (await call("GET", `/api/attempts/${attempt.attemptId}`, lina())).body,
      );
      expect(published).toContain("4217.5");
      expect(published).toContain("TEMOIN-MODELE");
    });

    it("mélange les options du QCM par tentative, avec des identifiants opaques propres à chacune (ADR-0007)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, { learnerId: family.learner.id });
      const forNoe = await assign(world, tutor(), qcmId, { learnerId: family.otherLearner.id });
      const a = await start(lina(), assignmentId);
      const b = await start(family.otherLearner.cookie, forNoe);
      const idsA = a.questions[0]?.options?.map((option) => option.id) ?? [];
      const idsB = b.questions[0]?.options?.map((option) => option.id) ?? [];
      expect(idsA).toHaveLength(4);
      expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
      expect(a.questions[0]?.options?.map((option) => option.text).sort()).toEqual(["1", "12", "34", "7"]);
      // L'ordre est tiré par le serveur et conservé pour la tentative : la reprise rend le même ordre.
      expect((await start(lina(), assignmentId)).questions[0]?.options).toEqual(a.questions[0]?.options);
    });

    it("pour une question numérique, l'élève reçoit les unités de la grandeur, jamais l'unité attendue seule (R5)", async () => {
      const assignmentId = await assign(world, tutor(), mixedId, { learnerId: family.learner.id });
      const attempt = await start(lina(), assignmentId);
      expect(attempt.questions[1]?.units).toEqual(["mm", "cm", "dm", "m", "dam", "hm", "km"]);
    });
  });

  describe("Fenêtre et tentatives selon l'horloge du serveur (R5)", () => {
    const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);

    it("ouverture − 1 s refusée, ouverture + 0 s acceptée (R5)", async () => {
      const opensAt = new Date("2026-10-13T08:00:00Z");
      const assignmentId = await assign(world, tutor(), qcmId, { learnerId: family.learner.id, opensAt });
      world.clock.setTo(at(opensAt, -1));
      const cookie = await loginLearner(world, "lina");
      const early = await startAttempt(world, cookie, assignmentId);
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ code: "assessment.not-yet-open" });
      world.clock.setTo(opensAt);
      expect((await startAttempt(world, cookie, assignmentId)).status).toBe(200);
    });

    it("échéance − 1 s : on commence et on rend ; échéance + 0 s : rendu refusé (R5)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, {
        learnerId: family.learner.id,
        maxAttempts: 2,
      });
      world.clock.setTo(at(FRIDAY_18H, -1));
      const cookie = await loginLearner(world, "lina");
      const first = await start(cookie, assignmentId);
      expect((await submit(cookie, first.attemptId)).status).toBe(200);
      const second = await start(cookie, assignmentId);
      world.clock.setTo(FRIDAY_18H);
      const late = await submit(cookie, second.attemptId);
      expect(late.status).toBe(409);
      expect(late.body).toMatchObject({ code: "assessment.closed" });
      const saving = await call("PUT", `/api/attempts/${second.attemptId}/answers`, cookie, { answers: {} });
      expect(saving.body).toMatchObject({ code: "assessment.closed" });
    });

    it("retard autorisé : la copie rendue après l'échéance est marquée en retard (H7)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, {
        learnerId: family.learner.id,
        lateAllowed: true,
      });
      world.clock.setTo(at(FRIDAY_18H, 3600));
      const cookie = await loginLearner(world, "lina");
      const attempt = await start(cookie, assignmentId);
      expect((await submit(cookie, attempt.attemptId)).body).toMatchObject({ late: true });
    });

    it("la dernière tentative est permise, pas la suivante ; une seule tentative en cours à la fois (R5, M6)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, {
        learnerId: family.learner.id,
        maxAttempts: 2,
      });
      const first = await start(lina(), assignmentId);
      expect((await start(lina(), assignmentId)).attemptId).toBe(first.attemptId);
      await submit(lina(), first.attemptId);
      const last = await start(lina(), assignmentId);
      expect(last.number).toBe(2);
      await submit(lina(), last.attemptId);
      const refused = await startAttempt(world, lina(), assignmentId);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "assessment.no-attempts-left" });
    });

    it("deux rendus simultanés : un seul passe, la copie n'est figée qu'une fois (R5, R6)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, { learnerId: family.learner.id });
      const attempt = await start(lina(), assignmentId);
      const answers = {
        [attempt.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [optionWithText(attempt, 0, "12")] },
      };
      const results = await Promise.all([
        submit(lina(), attempt.attemptId, answers),
        submit(lina(), attempt.attemptId, { ...answers }),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const rows = await world.adminQuery<{ n: number }>(
        "SELECT count(*)::int AS n FROM assessment.question_results",
      );
      expect(rows[0]?.n).toBe(1);
    });

    it("deux démarrages simultanés : une seule tentative est créée (R5)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, { learnerId: family.learner.id });
      const results = await Promise.all([
        startAttempt(world, lina(), assignmentId),
        startAttempt(world, lina(), assignmentId),
      ]);
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      const rows = await world.adminQuery<{ n: number }>(
        "SELECT count(*)::int AS n FROM assessment.attempts",
      );
      expect(rows[0]?.n).toBe(1);
    });

    it("un brouillon s'enregistre au plus toutes les 5 s (R15)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, { learnerId: family.learner.id });
      const attempt = await start(lina(), assignmentId);
      const answers = {
        [attempt.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [optionWithText(attempt, 0, "7")] },
      };
      expect(
        (await call("PUT", `/api/attempts/${attempt.attemptId}/answers`, lina(), { answers })).status,
      ).toBe(204);
      const tooSoon = await call("PUT", `/api/attempts/${attempt.attemptId}/answers`, lina(), { answers });
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.headers["retry-after"]).toBe("5");
      world.clock.advanceBy(5_000);
      expect(
        (await call("PUT", `/api/attempts/${attempt.attemptId}/answers`, lina(), { answers })).status,
      ).toBe(204);
      const view = (await call("GET", `/api/attempts/${attempt.attemptId}`, lina())).body as {
        answers: Record<string, unknown>;
      };
      expect(Object.values(view.answers)).toEqual([
        { kind: "mcq", optionIds: [optionWithText(attempt, 0, "7")] },
      ]);
    });
  });

  describe("Copie figée et correction (R6, R12)", () => {
    async function publishedMixed(): Promise<{ attempt: LearnerAttempt; assignmentId: string }> {
      const assignmentId = await assign(world, tutor(), mixedId, { learnerId: family.learner.id });
      const attempt = await start(lina(), assignmentId);
      expect((await submit(lina(), attempt.attemptId, mixedAnswers(attempt))).status).toBe(200);
      await call("POST", `/api/grading/attempts/${attempt.attemptId}/grades`, tutor(), {
        grades: [
          { questionId: attempt.questions[2]?.id, earned: 2.5, comment: "Méthode juste, à détailler." },
        ],
      });
      expect((await call("POST", `/api/grading/attempts/${attempt.attemptId}/publish`, tutor())).status).toBe(
        204,
      );
      return { attempt, assignmentId };
    }

    it("une modification directe en SQL d'une copie rendue est refusée par la base (R6)", async () => {
      const { attempt } = await publishedMixed();
      const id = attempt.attemptId.replace(/^att_/, "");
      for (const sql of [
        `UPDATE assessment.attempts SET answers = '{}' WHERE id = $1`,
        `UPDATE assessment.attempts SET answers_sha256 = repeat('0', 64) WHERE id = $1`,
        `UPDATE assessment.attempts SET submitted_at = submitted_at + interval '1 day' WHERE id = $1`,
        `UPDATE assessment.attempts SET grade = 20 WHERE id = $1`,
        `UPDATE assessment.question_results SET earned = 0 WHERE attempt_id = $1`,
        `DELETE FROM assessment.attempts WHERE id = $1`,
      ]) {
        await expect(world.adminQuery(sql, [id]), sql).rejects.toThrow(/R6/);
      }
    });

    it("une copie rendue ne repasse jamais en brouillon, même en SQL (R6)", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, { learnerId: family.learner.id });
      const attempt = await start(lina(), assignmentId);
      await submit(lina(), attempt.attemptId);
      const id = attempt.attemptId.replace(/^att_/, "");
      await expect(
        world.adminQuery(
          `UPDATE assessment.attempts SET status = 'draft', submitted_at = NULL, answers_sha256 = NULL WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/R6/);
    });

    it("correction automatique et conversion d'unités : 42,175 m pour 4 217,5 cm est juste en unité libre (big picture §8)", async () => {
      const assignmentId = await assign(world, tutor(), mixedId, { learnerId: family.learner.id });
      const attempt = await start(lina(), assignmentId);
      await submit(lina(), attempt.attemptId, mixedAnswers(attempt));
      const detail = (await call("GET", `/api/grading/attempts/${attempt.attemptId}`, tutor())).body as {
        status: string;
        grade: number | null;
        results: Array<{ questionId: string; earned: number | null; gradedBy: string }>;
        answersSha256: string;
      };
      const earned = Object.fromEntries(
        detail.results.map((result) => [result.questionId, [result.earned, result.gradedBy]]),
      );
      expect(earned[attempt.questions[0]?.id ?? ""]).toEqual([2, "auto"]);
      expect(earned[attempt.questions[1]?.id ?? ""]).toEqual([3, "auto"]);
      expect(earned[attempt.questions[2]?.id ?? ""]).toEqual([null, "pending"]);
      // Pas de note tant qu'une question attend le tuteur (big picture §8).
      expect(detail).toMatchObject({ status: "submitted", grade: null });
      expect(detail.answersSha256).toMatch(/^[0-9a-f]{64}$/);
      const refused = await call("POST", `/api/grading/attempts/${attempt.attemptId}/publish`, tutor());
      expect(refused.body).toMatchObject({ code: "assessment.grading-incomplete" });
      const queue = (await call("GET", "/api/grading/attempts", tutor())).body as {
        attempts: Array<{ attemptId: string }>;
      };
      expect(queue.attempts.map((entry) => entry.attemptId)).toEqual([attempt.attemptId]);
    });

    it("correction manuelle, puis publication : note sur 20 au demi-point, commentaire visible de l'élève (R6)", async () => {
      const { attempt } = await publishedMixed();
      const view = (await call("GET", `/api/attempts/${attempt.attemptId}`, lina())).body as {
        correction: { grade: number; questions: Array<{ comment: string | null }> };
      };
      // (2 + 3 + 2,5) / 10 × 20 = 15
      expect(view.correction.grade).toBe(15);
      expect(view.correction.questions[2]?.comment).toBe("Méthode juste, à détailler.");
      const events = await world.adminQuery<{ type: string; payload: Record<string, unknown> }>(
        "SELECT type, payload FROM messaging.outbox WHERE type = 'assessment.correction-published'",
      );
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0]?.payload)).not.toContain("J'ai converti");
    });

    it("rectifier une note publiée exige un motif ; l'ancienne et la nouvelle valeur sont historisées et auditées (R6, R12)", async () => {
      const { attempt } = await publishedMixed();
      const url = `/api/grading/attempts/${attempt.attemptId}/rectifications`;
      const questionId = attempt.questions[2]?.id;
      expect((await call("POST", url, tutor(), { questionId, earned: 5 })).status).toBe(400);
      const short = await call("POST", url, tutor(), { questionId, earned: 5, reason: "oui" });
      expect(short.body).toMatchObject({ code: "assessment.reason-required" });
      const before = (await call("GET", `/api/grading/attempts/${attempt.attemptId}`, tutor())).body as {
        answersSha256: string;
      };
      expect(
        (
          await call("POST", url, tutor(), {
            questionId,
            earned: 5,
            reason: "Barème mal appliqué à la relecture.",
          })
        ).status,
      ).toBe(204);
      const after = (await call("GET", `/api/grading/attempts/${attempt.attemptId}`, tutor())).body as {
        grade: number;
        answersSha256: string;
        rectifications: Array<{
          previousEarned: number;
          newEarned: number;
          previousGrade: number;
          newGrade: number;
          reason: string;
        }>;
      };
      expect(after.grade).toBe(20);
      expect(after.answersSha256).toBe(before.answersSha256);
      expect(after.rectifications).toEqual([
        expect.objectContaining({
          previousEarned: 2.5,
          newEarned: 5,
          previousGrade: 15,
          newGrade: 20,
          reason: "Barème mal appliqué à la relecture.",
        }),
      ]);
      const audit = await world.adminQuery<{ action: string }>(
        "SELECT action FROM audit.audit_log WHERE action = 'assessment.rectified'",
      );
      expect(audit).toHaveLength(1);
      expect(
        (
          (await call("GET", `/api/attempts/${attempt.attemptId}`, lina())).body as {
            correction: { grade: number };
          }
        ).correction.grade,
      ).toBe(20);
      await expect(
        world.adminQuery(`UPDATE assessment.grade_rectifications SET reason = 'effacé'`),
      ).rejects.toThrow(/R6/);
      await expect(world.adminQuery(`DELETE FROM assessment.grade_rectifications`)).rejects.toThrow(/R6/);
    });

    it("publication automatique : l'élève reçoit sa note et le corrigé dès le rendu d'un QCM", async () => {
      const assignmentId = await assign(world, tutor(), qcmId, {
        learnerId: family.learner.id,
        publication: "auto",
      });
      const attempt = await start(lina(), assignmentId);
      const res = await submit(lina(), attempt.attemptId, {
        [attempt.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [optionWithText(attempt, 0, "7")] },
      });
      expect(res.body).toMatchObject({ status: "published", correction: { grade: 0 } });
      const guardian = await loginGuardian(world, "awa@example.org");
      expect(
        (
          (await call("GET", `/api/learners/${family.learner.id}/results`, guardian)).body as {
            results: unknown[];
          }
        ).results,
      ).toHaveLength(1);
    });
  });

  describe("Création des épreuves (tuteur)", () => {
    it("une épreuve attribuée n'est plus modifiable : les copies correspondent aux questions posées (R6)", async () => {
      await assign(world, tutor(), qcmId, { learnerId: family.learner.id });
      const competencies = (await call("GET", "/api/competencies", tutor())).body as {
        competencies: Array<{ id: string }>;
      };
      const res = await call("PUT", `/api/assessments/${qcmId}/questions`, tutor(), {
        questions: [mcqTwelve(competencies.competencies[0]?.id ?? "")],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "assessment.locked" });
    });

    it("une question n'évalue que des compétences proposées au choix (une compétence archivée est refusée)", async () => {
      const competencies = (await call("GET", "/api/competencies", tutor())).body as {
        competencies: Array<{ id: string }>;
      };
      const archived = competencies.competencies[3]?.id ?? "";
      expect((await call("POST", `/api/competencies/${archived}/archive`, tutor())).status).toBe(204);
      const res = await call("PUT", `/api/assessments/${mixedId}/questions`, tutor(), {
        questions: [mcqTwelve(archived)],
      });
      expect(res.body).toMatchObject({ code: "assessment.invalid-competencies" });
    });

    it("refuse une unité hors catalogue, un QCM sans bonne réponse existante et un barème hors demi-points (validation stricte)", async () => {
      const competencies = (await call("GET", "/api/competencies", tutor())).body as {
        competencies: Array<{ id: string }>;
      };
      const c = competencies.competencies[0]?.id ?? "";
      const put = (question: object) =>
        call("PUT", `/api/assessments/${mixedId}/questions`, tutor(), { questions: [question] });
      expect(
        (
          await put({
            kind: "numeric",
            prompt: "?",
            points: 1,
            competencyIds: [c],
            expected: "1",
            tolerance: "0",
            unit: "pouce",
            unitMode: "free",
          })
        ).body,
      ).toMatchObject({
        code: "assessment.invalid-unit",
      });
      expect((await put({ ...mcqTwelve(c), correctOptions: [6] })).body).toMatchObject({
        code: "assessment.invalid-correct-options",
      });
      expect((await put({ ...mcqTwelve(c), points: 1.25 })).status).toBe(400);
      expect((await put({ ...mcqTwelve(c), hidden: true })).status).toBe(400);
    });

    it("on n'attribue pas à un compte qui n'est pas un élève de l'espace, même présenté comme tel (404, R2)", async () => {
      const [guardian] = await world.adminQuery<{ id: string }>(
        "SELECT id FROM identity.accounts WHERE role = 'guardian' LIMIT 1",
      );
      const guardianAsLearner = `lrn_${guardian?.id ?? ""}`;
      const res = await call("POST", "/api/assignments", tutor(), {
        assessmentId: qcmId,
        audience: { kind: "learner", id: guardianAsLearner },
        opensAt: "2026-10-12T07:00:00.000Z",
        dueAt: "2026-10-16T16:00:00.000Z",
        maxAttempts: 1,
        lateAllowed: false,
        publication: "manual",
      });
      expect(res.status).toBe(404);
    });
  });
});
