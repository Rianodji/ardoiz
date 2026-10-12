import { expect } from "vitest";
import { runFeature, type StepDefinition } from "../bdd/runFeature.js";
import { setupFamily, type Family } from "./support/families.js";
import { setupProgramme, unlock, type Programme } from "./support/programme.js";
import { World, type HttpResult } from "./support/world.js";

interface Scenario {
  readonly world: World;
  family?: Family;
  programme?: Programme;
  lastResponse?: HttpResult;
  lastMedia?: HttpResult;
}

const family = (s: Scenario): Family => {
  if (s.family === undefined) throw new Error("Famille absente.");
  return s.family;
};
const programme = (s: Scenario): Programme => {
  if (s.programme === undefined) throw new Error("Programme absent.");
  return s.programme;
};
/** Lina est l'élève « concerné » de la famille type, Noé l'« autre élève ». */
const cookieOf = (s: Scenario, name: string): string => {
  if (name === "Lina") return family(s).learner.cookie;
  if (name === "Noé") return family(s).otherLearner.cookie;
  throw new Error(`Élève inconnu : ${name}`);
};
const learnerIdOf = (s: Scenario, name: string): string =>
  name === "Lina" ? family(s).learner.id : family(s).otherLearner.id;

async function readLessonAndImage(s: Scenario, name: string): Promise<void> {
  const cookie = cookieOf(s, name);
  s.lastResponse = await s.world.http({
    method: "GET",
    url: `/api/lessons/${programme(s).lessonId}`,
    cookie,
  });
  s.lastMedia = await s.world.http({ method: "GET", url: `/api/media/${programme(s).mediaId}`, cookie });
}

const expectNotFound = (response: HttpResult | undefined): void => {
  expect(response?.status).toBe(404);
  expect(response?.body).toMatchObject({ code: "application.not-found" });
};

const steps: ReadonlyArray<StepDefinition<Scenario>> = [
  {
    pattern: /^un espace tuteur avec les élèves "Lina" et "Noé" dans le groupe "Neveux 5e"$/,
    run: async (s) => {
      s.family = await setupFamily(s.world);
    },
  },
  {
    pattern: /^un cours publié "Convertir des longueurs" contenant une image$/,
    run: async (s) => {
      s.programme = await setupProgramme(s.world, family(s));
    },
  },
  {
    pattern: /^"(Lina|Noé)" demande le cours(?: "Convertir des longueurs")?$/,
    run: (s, name = "") => readLessonAndImage(s, name),
  },
  {
    pattern: /^la réponse est "introuvable"$/,
    run: (s) => {
      expectNotFound(s.lastResponse);
      return Promise.resolve();
    },
  },
  {
    pattern: /^l'image du cours est "introuvable" pour "(Lina|Noé)"$/,
    run: async (s, name = "") => {
      await readLessonAndImage(s, name);
      expectNotFound(s.lastMedia);
    },
  },
  {
    pattern: /^le tuteur déverrouille le cours pour le groupe "Neveux 5e"$/,
    run: async (s) => {
      await unlock(
        s.world,
        family(s).tutor.cookie,
        { kind: "lesson", id: programme(s).lessonId },
        { kind: "group", id: programme(s).groupId },
      );
    },
  },
  {
    pattern: /^"Lina" et "Noé" voient le cours et son image$/,
    run: async (s) => {
      for (const name of ["Lina", "Noé"]) {
        await readLessonAndImage(s, name);
        expect(s.lastResponse?.status).toBe(200);
        expect(s.lastMedia?.status).toBe(200);
        expect(s.lastMedia?.headers["content-type"]).toBe("image/webp");
      }
    },
  },
  {
    pattern: /^le tuteur déverrouille le cours pour "(Lina|Noé)" seulement$/,
    run: async (s, name = "") => {
      await unlock(
        s.world,
        family(s).tutor.cookie,
        { kind: "lesson", id: programme(s).lessonId },
        { kind: "learner", id: learnerIdOf(s, name) },
      );
    },
  },
  {
    pattern: /^"(Lina|Noé)" voit le cours$/,
    run: async (s, name = "") => {
      await readLessonAndImage(s, name);
      expect(s.lastResponse?.status).toBe(200);
      expect(s.lastResponse?.body).toMatchObject({ title: "Convertir des longueurs" });
    },
  },
  {
    pattern: /^le cours est "introuvable" pour "(Lina|Noé)"$/,
    run: async (s, name = "") => {
      await readLessonAndImage(s, name);
      expectNotFound(s.lastResponse);
      expectNotFound(s.lastMedia);
    },
  },
  {
    pattern: /^(?:que )?le cours repasse en brouillon$/,
    run: async (s) => {
      const res = await s.world.http({
        method: "POST",
        url: `/api/lessons/${programme(s).lessonId}/unpublish`,
        cookie: family(s).tutor.cookie,
      });
      expect(res.status).toBe(204);
    },
  },
  {
    pattern: /^(?:qu')?il est déverrouillé pour "(Lina|Noé)"$/,
    run: async (s, name = "") => {
      await unlock(
        s.world,
        family(s).tutor.cookie,
        { kind: "lesson", id: programme(s).lessonId },
        { kind: "learner", id: learnerIdOf(s, name) },
      );
    },
  },
];

runFeature<Scenario>("deverrouillage.feature", steps, {
  create: async () => ({ world: await World.create() }),
  dispose: (scenario) => scenario.world.close(),
});
