import { expect } from "vitest";
import { runFeature, type StepDefinition } from "../bdd/runFeature.js";
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
} from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { World, type HttpResult } from "./support/world.js";

interface Scenario {
  readonly world: World;
  family?: Family;
  assignmentId?: string;
  attempt?: LearnerAttempt;
  lastResponse?: HttpResult;
  /** Sessions de Lina et de ses deux parents, renouvelées après un saut d'horloge. */
  viewers?: string[];
}

const family = (s: Scenario): Family => {
  if (s.family === undefined) throw new Error("Famille absente.");
  return s.family;
};
const assignmentId = (s: Scenario): string => {
  if (s.assignmentId === undefined) throw new Error("Attribution absente.");
  return s.assignmentId;
};
const attempt = (s: Scenario): LearnerAttempt => {
  if (s.attempt === undefined) throw new Error("Tentative absente.");
  return s.attempt;
};

const viewers = (s: Scenario): string[] =>
  s.viewers ?? [family(s).learner.cookie, family(s).linkedGuardian, family(s).coGuardian];

interface PublishedView {
  correction: { grade: number } | null;
  answerKey: { questions: Array<{ expected: unknown; explanation: string | null }> } | null;
}

async function viewAttempt(s: Scenario, cookie: string): Promise<PublishedView> {
  const view = await s.world.http({ method: "GET", url: `/api/attempts/${attempt(s).attemptId}`, cookie });
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  return view.body as PublishedView;
}

/** Motifs de refus tels que l'interface les affiche, reliés aux codes stables de l'API. */
const REASONS: Readonly<Record<string, string>> = {
  "épreuve fermée": "assessment.closed",
  "tentatives épuisées": "assessment.no-attempts-left",
};

/** Toutes les clés et valeurs d'un document JSON, à toute profondeur. */
function walk(
  value: unknown,
  visit: (key: string | null, leaf: unknown) => void,
  key: string | null = null,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, key);
  } else if (value !== null && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      visit(k, v);
      walk(v, visit, k);
    }
  else visit(key, value);
}

async function openAssessment(s: Scenario): Promise<void> {
  s.lastResponse = await startAttempt(s.world, family(s).learner.cookie, assignmentId(s));
  expect(s.lastResponse.status, JSON.stringify(s.lastResponse.body)).toBe(200);
  s.attempt = s.lastResponse.body as LearnerAttempt;
}

async function submitTwelve(s: Scenario): Promise<void> {
  await openAssessment(s);
  const question = attempt(s).questions[0];
  if (question === undefined) throw new Error("Question absente.");
  s.lastResponse = await s.world.http({
    method: "POST",
    url: `/api/attempts/${attempt(s).attemptId}/submit`,
    cookie: family(s).learner.cookie,
    payload: {
      answers: { [question.id]: { kind: "mcq", optionIds: [optionWithText(attempt(s), 0, "12")] } },
    },
  });
  expect(s.lastResponse.status, JSON.stringify(s.lastResponse.body)).toBe(200);
}

const steps: ReadonlyArray<StepDefinition<Scenario>> = [
  {
    pattern: /^une épreuve "Arithmétique 1" avec une question QCM dont la bonne réponse est "12"$/,
    run: async (s) => {
      s.family = await setupFamily(s.world);
      const { assessmentId } = await createAssessment(
        s.world,
        family(s).tutor.cookie,
        "Arithmétique 1",
        ([competencyId = ""]) => [mcqTwelve(competencyId)],
      );
      s.assignmentId = assessmentId; // remplacé à l'étape suivante par l'attribution
    },
  },
  {
    pattern:
      /^l'épreuve est attribuée à "Lina" du lundi 9 h au vendredi 18 h avec 1 tentative, publication manuelle$/,
    run: async (s) => {
      s.assignmentId = await assign(s.world, family(s).tutor.cookie, assignmentId(s), {
        learnerId: family(s).learner.id,
        maxAttempts: 1,
        publication: "manual",
      });
    },
  },
  { pattern: /^"Lina" ouvre l'épreuve$/, run: openAssessment },
  {
    pattern: /^la réponse reçue ne contient aucune réponse attendue ni aucun barème par option$/,
    run: (s) => {
      const keys: string[] = [];
      walk(s.lastResponse?.body, (key) => {
        if (key !== null) keys.push(key);
      });
      for (const forbidden of [
        "correct",
        "correctOptions",
        "correctOptionIds",
        "expected",
        "tolerance",
        "unitMode",
        "modelAnswer",
        "explanation",
        "spec",
        "score",
        "weight",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
      // Les options n'ont qu'un identifiant opaque et un texte : ni position d'origine, ni points.
      for (const option of attempt(s).questions[0]?.options ?? [])
        expect(Object.keys(option).sort()).toEqual(["id", "text"]);
      expect(attempt(s).correction).toBeNull();
      return Promise.resolve();
    },
  },
  { pattern: /^"Lina" choisit "12" et rend sa copie$/, run: submitTwelve },
  { pattern: /^(?:que )?"Lina" a rendu sa copie$/, run: submitTwelve },
  {
    pattern: /^la copie est figée$/,
    run: async (s) => {
      const rows = await s.world.adminQuery<{ status: string; answers_sha256: string | null }>(
        "SELECT status, answers_sha256 FROM assessment.attempts",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).not.toBe("draft");
      expect(rows[0]?.answers_sha256).toMatch(/^[0-9a-f]{64}$/);
    },
  },
  {
    pattern: /^la question est corrigée automatiquement avec la totalité des points$/,
    run: async (s) => {
      const detail = await s.world.http({
        method: "GET",
        url: `/api/grading/attempts/${attempt(s).attemptId}`,
        cookie: family(s).tutor.cookie,
      });
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        status: "graded",
        grade: 20,
        results: [{ earned: 2, gradedBy: "auto" }],
      });
    },
  },
  {
    pattern: /^"Lina" ne voit pas encore sa note$/,
    run: async (s) => {
      expect((s.lastResponse?.body as LearnerAttempt).correction).toBeNull();
      const view = await s.world.http({
        method: "GET",
        url: `/api/attempts/${attempt(s).attemptId}`,
        cookie: family(s).learner.cookie,
      });
      expect(view.body).toMatchObject({ status: "graded", correction: null });
      const mine = await s.world.http({
        method: "GET",
        url: "/api/my/assignments",
        cookie: family(s).learner.cookie,
      });
      expect(mine.body).toMatchObject({ assignments: [{ state: "submitted", grade: null }] });
      const results = await s.world.http({
        method: "GET",
        url: `/api/learners/${family(s).learner.id}/results`,
        cookie: family(s).learner.cookie,
      });
      expect(results.body).toEqual({ results: [] });
    },
  },
  {
    pattern: /^(?:que )?le tuteur (?:publie|a publié) la correction$/,
    run: async (s) => {
      const res = await s.world.http({
        method: "POST",
        url: `/api/grading/attempts/${attempt(s).attemptId}/publish`,
        cookie: family(s).tutor.cookie,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    },
  },
  {
    pattern: /^"Lina" et ses parents voient la note, sans le corrigé$/,
    run: async (s) => {
      for (const cookie of viewers(s)) {
        const body = await viewAttempt(s, cookie);
        expect(body.correction?.grade).toBe(20);
        // Publiée mais pas révélée : ni bonne option, ni explication (R5, verdict L3 R-1).
        expect(body.answerKey).toBeNull();
        expect(JSON.stringify(body)).not.toContain("4 + 4 + 4");
      }
      // L'événement CorrectionPubliée est dans l'outbox, écrit avec la publication.
      const events = await s.world.adminQuery<{ type: string }>("SELECT type FROM messaging.outbox");
      expect(events.map((event) => event.type)).toContain("assessment.correction-published");
    },
  },
  {
    pattern: /^l'échéance du vendredi 18 h est passée$/,
    run: async (s) => {
      s.world.clock.setTo(FRIDAY_18H);
      // Les sessions ont expiré pendant la semaine (R8) : chacun se reconnecte.
      s.viewers = [
        await loginLearner(s.world, "lina"),
        await loginGuardian(s.world, "awa@example.org"),
        await loginGuardian(s.world, "moussa@example.org"),
      ];
    },
  },
  {
    pattern: /^"Lina" et ses parents voient la note et le corrigé$/,
    run: async (s) => {
      for (const cookie of viewers(s)) {
        const body = await viewAttempt(s, cookie);
        expect(body.correction?.grade).toBe(20);
        expect(body.answerKey?.questions[0]?.expected).toEqual({
          kind: "mcq",
          correctOptionIds: [optionWithText(attempt(s), 0, "12")],
        });
        expect(body.answerKey?.questions[0]?.explanation).toBe("3 × 4 = 4 + 4 + 4 = 12.");
        const results = await s.world.http({
          method: "GET",
          url: `/api/learners/${family(s).learner.id}/results`,
          cookie,
        });
        expect(results.body).toMatchObject({ results: [{ title: "Arithmétique 1", grade: 20 }] });
      }
    },
  },
  {
    pattern: /^"Lina" commence l'épreuve le vendredi à 18 h 00 min 00 s$/,
    run: async (s) => {
      s.world.clock.setTo(FRIDAY_18H);
      const cookie = await loginLearner(s.world, "lina");
      s.lastResponse = await startAttempt(s.world, cookie, assignmentId(s));
    },
  },
  {
    pattern: /^"Lina" commence une nouvelle tentative$/,
    run: async (s) => {
      s.lastResponse = await startAttempt(s.world, family(s).learner.cookie, assignmentId(s));
    },
  },
  {
    pattern: /^la demande est refusée avec le motif "(épreuve fermée|tentatives épuisées)"$/,
    run: (s, reason = "") => {
      expect(s.lastResponse?.status).toBe(409);
      expect(s.lastResponse?.body).toMatchObject({ code: REASONS[reason] });
      return Promise.resolve();
    },
  },
];

runFeature<Scenario>("correction-qcm.feature", steps, {
  create: async () => ({ world: await World.create() }),
  dispose: (scenario) => scenario.world.close(),
});
