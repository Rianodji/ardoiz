import { expect } from "vitest";
import { runFeature, type StepDefinition } from "../bdd/runFeature.js";
import { startAttempt, type LearnerAttempt } from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { notebookAssessment, rectangle, saveScene, textElement, triangle } from "./support/notebook.js";
import { World, type HttpResult } from "./support/world.js";

interface Scenario {
  readonly world: World;
  family?: Family;
  assignmentId?: string;
  attempt?: LearnerAttempt;
  lastResponse?: HttpResult;
  copySha256?: string;
}

const family = (s: Scenario): Family => {
  if (s.family === undefined) throw new Error("Famille absente.");
  return s.family;
};
const attempt = (s: Scenario): LearnerAttempt => {
  if (s.attempt === undefined) throw new Error("Tentative absente.");
  return s.attempt;
};
const questionId = (s: Scenario): string => attempt(s).questions[0]?.id ?? "";
const uuid = (prefixed: string) => prefixed.slice(4);

/** Motifs de refus tels que l'interface les affiche, reliés aux codes stables de l'API. */
const REASONS: Readonly<Record<string, string>> = {
  "cahier trop volumineux": "assessment.notebook-too-large",
};

async function copyFingerprint(s: Scenario): Promise<{ answers: string | null; scene: string | null }> {
  const [row] = await s.world.adminQuery<{ answers_sha256: string | null; scene_sha256: string | null }>(
    `SELECT a.answers_sha256, n.scene_sha256
       FROM assessment.attempts a LEFT JOIN assessment.notebook_scenes n ON n.attempt_id = a.id
      WHERE a.id = $1`,
    [uuid(attempt(s).attemptId)],
  );
  return { answers: row?.answers_sha256 ?? null, scene: row?.scene_sha256 ?? null };
}

async function submit(s: Scenario): Promise<void> {
  if (s.attempt === undefined) {
    s.attempt = (await startAttempt(s.world, family(s).learner.cookie, s.assignmentId ?? ""))
      .body as LearnerAttempt;
    expect((await saveScene(s.world, family(s).learner.cookie, attempt(s), [triangle()])).status).toBe(204);
  }
  const res = await s.world.http({
    method: "POST",
    url: `/api/attempts/${attempt(s).attemptId}/submit`,
    cookie: family(s).learner.cookie,
    payload: {},
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const steps: ReadonlyArray<StepDefinition<Scenario>> = [
  {
    pattern: /^une épreuve "Géométrie : tracer un triangle" avec une question de type cahier$/,
    run: async (s) => {
      s.family = await setupFamily(s.world);
    },
  },
  {
    pattern: /^elle est attribuée à "Lina"$/,
    run: async (s) => {
      s.assignmentId = (await notebookAssessment(s.world, family(s))).assignmentId;
    },
  },
  {
    pattern: /^"Lina" dessine un triangle et que la sauvegarde automatique s'exécute$/,
    run: async (s) => {
      s.attempt = (await startAttempt(s.world, family(s).learner.cookie, s.assignmentId ?? ""))
        .body as LearnerAttempt;
      const res = await saveScene(s.world, family(s).learner.cookie, attempt(s), [triangle()]);
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    },
  },
  {
    pattern: /^(?:qu')?elle recharge la page$/,
    run: async (s) => {
      s.lastResponse = await s.world.http({
        method: "GET",
        url: `/api/attempts/${attempt(s).attemptId}`,
        cookie: family(s).learner.cookie,
      });
    },
  },
  {
    pattern: /^elle retrouve son triangle$/,
    run: (s) => {
      expect(s.lastResponse?.status).toBe(200);
      const body = s.lastResponse?.body as { answers: Record<string, { kind: string; elements: unknown[] }> };
      expect(body.answers[questionId(s)]).toEqual({ kind: "notebook", elements: [triangle()], formulas: [] });
      return Promise.resolve();
    },
  },
  { pattern: /^(?:que )?"Lina" (?:rend|a rendu) sa copie$/, run: submit },
  {
    pattern: /^l'empreinte de la copie est enregistrée$/,
    run: async (s) => {
      const fingerprint = await copyFingerprint(s);
      expect(fingerprint.answers).toMatch(/^[0-9a-f]{64}$/);
      expect(fingerprint.scene).toMatch(/^[0-9a-f]{64}$/);
    },
  },
  {
    pattern: /^toute nouvelle sauvegarde de "Lina" sur cette copie est refusée$/,
    run: async (s) => {
      s.world.clock.advanceBy(10_000);
      const res = await saveScene(s.world, family(s).learner.cookie, attempt(s), [
        triangle(),
        rectangle("ajout"),
      ]);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "assessment.attempt-submitted" });
      // Même en SQL direct, la scène d'une copie rendue est figée (R6).
      await expect(
        s.world.adminQuery(
          `UPDATE assessment.notebook_scenes SET scene = '{"elements":[]}' WHERE attempt_id = $1`,
          [uuid(attempt(s).attemptId)],
        ),
      ).rejects.toThrow(/figée/);
    },
  },
  {
    pattern: /^le tuteur ajoute une annotation "([^"]+)" et attribue 3 points sur 5$/,
    run: async (s, text = "") => {
      const before = await copyFingerprint(s);
      s.copySha256 = `${before.answers ?? ""}/${before.scene ?? ""}`;
      const tutor = family(s).tutor.cookie;
      const annotated = await s.world.http({
        method: "PUT",
        url: `/api/grading/attempts/${attempt(s).attemptId}/annotations/${questionId(s)}`,
        cookie: tutor,
        payload: { elements: [textElement("note-1", text, "#e03131")] },
      });
      expect(annotated.status, JSON.stringify(annotated.body)).toBe(204);
      const graded = await s.world.http({
        method: "POST",
        url: `/api/grading/attempts/${attempt(s).attemptId}/grades`,
        cookie: tutor,
        payload: { grades: [{ questionId: questionId(s), earned: 3, comment: text }] },
      });
      expect(graded.status, JSON.stringify(graded.body)).toBe(204);
    },
  },
  {
    pattern: /^l'empreinte de la copie de "Lina" est inchangée$/,
    run: async (s) => {
      const after = await copyFingerprint(s);
      expect(`${after.answers ?? ""}/${after.scene ?? ""}`).toBe(s.copySha256);
    },
  },
  {
    pattern: /^l'annotation est enregistrée sur le calque du tuteur$/,
    run: async (s) => {
      const detail = await s.world.http({
        method: "GET",
        url: `/api/grading/attempts/${attempt(s).attemptId}`,
        cookie: family(s).tutor.cookie,
      });
      const body = detail.body as {
        grade: number;
        answers: Record<string, { elements: unknown[] }>;
        annotations: Record<string, { elements: Array<{ text?: string }> }>;
      };
      expect(body.annotations[questionId(s)]?.elements[0]?.text).toBe("Angle droit mal placé");
      // La scène de l'élève ne contient pas l'annotation : deux calques, jamais fusionnés (R6).
      expect(body.answers[questionId(s)]?.elements).toEqual([triangle()]);
      expect(body.grade).toBe(12);
    },
  },
  {
    pattern: /^"Lina" envoie une scène de 2 001 éléments$/,
    run: async (s) => {
      s.attempt = (await startAttempt(s.world, family(s).learner.cookie, s.assignmentId ?? ""))
        .body as LearnerAttempt;
      const elements = Array.from({ length: 2_001 }, (_, i) => rectangle(`r${String(i)}`));
      s.lastResponse = await saveScene(s.world, family(s).learner.cookie, attempt(s), elements);
    },
  },
  {
    pattern: /^la demande est refusée avec le motif "(cahier trop volumineux)"$/,
    run: (s, reason = "") => {
      expect(s.lastResponse?.status).toBe(413);
      expect(s.lastResponse?.body).toMatchObject({ code: REASONS[reason] });
      return Promise.resolve();
    },
  },
];

runFeature<Scenario>("cahier-rendu.feature", steps, {
  create: async () => ({ world: await World.create() }),
  dispose: (scenario) => scenario.world.close(),
});
