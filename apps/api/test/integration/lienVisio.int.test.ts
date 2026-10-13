import { expect } from "vitest";
import { runFeature, type StepDefinition } from "../bdd/runFeature.js";
import { loginLearner } from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import { planSession, plannedSession } from "./support/scheduling.js";
import { World, type HttpResult } from "./support/world.js";

interface Scenario {
  readonly world: World;
  family?: Family;
  occurrenceId?: string;
  link?: string;
  lastResponse?: HttpResult;
}

const family = (s: Scenario): Family => {
  if (s.family === undefined) throw new Error("Famille absente.");
  return s.family;
};

/** Mercredi 14 octobre 2026, en heure de Paris (UTC+2 jusqu'au 25 octobre). */
const WEDNESDAY = "2026-10-14";
const parisToUtc = (hour: number, minute: number) => new Date(Date.UTC(2026, 9, 14, hour - 2, minute));

async function consult(s: Scenario, name: string, hour: number, minute: number): Promise<void> {
  s.world.clock.setTo(parisToUtc(hour, minute));
  // Les sessions ont expiré depuis lundi (R8) : l'élève se reconnecte.
  const cookie = await loginLearner(s.world, name === "Lina" ? "lina" : "noe");
  s.lastResponse = await s.world.http({
    method: "GET",
    url: `/api/occurrences/${s.occurrenceId ?? ""}`,
    cookie,
  });
}

const steps: ReadonlyArray<StepDefinition<Scenario>> = [
  {
    pattern: /^une séance mercredi de 14 h 00 à 15 h 00 \(heure de Paris\) avec le lien "([^"]+)"$/,
    run: async (s, link = "") => {
      s.family = await setupFamily(s.world);
      s.link = link;
      const session = await plannedSession(s.world, family(s).tutor.cookie, {
        learnerId: family(s).learner.id,
        date: WEDNESDAY,
        time: "14:00",
        durationMinutes: 60,
        link,
      });
      s.occurrenceId = session.occurrences[0]?.occurrenceId ?? "";
    },
  },
  { pattern: /^"Lina" est participante, "Noé" ne l'est pas$/, run: () => Promise.resolve() },
  {
    pattern: /^"(Lina|Noé)" consulte la séance mercredi à (\d+) h (\d+)$/,
    run: (s, name = "", hour = "0", minute = "0") => consult(s, name, Number(hour), Number(minute)),
  },
  {
    pattern: /^elle voit la séance sans le lien$/,
    run: (s) => {
      expect(s.lastResponse?.status).toBe(200);
      expect(s.lastResponse?.body).toMatchObject({ title: "Séance de mathématiques", meetingLink: null });
      expect(JSON.stringify(s.lastResponse?.body)).not.toContain("meet.jit.si");
      return Promise.resolve();
    },
  },
  {
    pattern: /^elle obtient le lien de visio$/,
    run: (s) => {
      expect(s.lastResponse?.status).toBe(200);
      expect(s.lastResponse?.body).toMatchObject({ meetingLink: s.link });
      return Promise.resolve();
    },
  },
  {
    pattern: /^la réponse est "introuvable"$/,
    run: (s) => {
      expect(s.lastResponse?.status).toBe(404);
      expect(s.lastResponse?.body).toMatchObject({ code: "application.not-found" });
      return Promise.resolve();
    },
  },
  {
    pattern: /^le tuteur enregistre le lien "([^"]*)"$/,
    run: async (s, link = "") => {
      s.lastResponse = await planSession(s.world, family(s).tutor.cookie, {
        learnerId: family(s).learner.id,
        date: "2026-10-21",
        time: "14:00",
        link,
      });
    },
  },
  {
    pattern: /^l'enregistrement est "(accepté|refusé)"$/,
    run: (s, outcome = "") => {
      if (outcome === "accepté") {
        expect(s.lastResponse?.status, JSON.stringify(s.lastResponse?.body)).toBe(201);
      } else {
        expect(s.lastResponse?.status).toBe(422);
        expect(s.lastResponse?.body).toMatchObject({ code: "scheduling.invalid-link" });
      }
      return Promise.resolve();
    },
  },
];

runFeature<Scenario>("lien-visio.feature", steps, {
  create: async () => ({ world: await World.create() }),
  dispose: (scenario) => scenario.world.close(),
});
