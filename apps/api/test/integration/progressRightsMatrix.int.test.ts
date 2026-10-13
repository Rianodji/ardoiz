import { expect } from "vitest";
import { mathsAndCompetencies } from "./support/assessment.js";
import { setupFamily, setupOtherSpaceTutor, type Family } from "./support/families.js";
import { runRightsMatrix, type MatrixRow, type Profile } from "./support/rightsMatrix.js";
import { World } from "./support/world.js";

interface Fixture extends Family {
  readonly otherSpaceTutor: string;
  readonly competencyId: string;
  /** Suggestion d'Awa (parent lié de Lina). */
  readonly suggestionId: string;
}

/** Matrice des droits de la progression (R2, R17) : la progression de Lina. */
const rows: ReadonlyArray<MatrixRow<Fixture>> = [
  {
    action: "Voir le profil et la progression d'un élève",
    expected: {
      tutor: "allow",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "allow",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "GET", url: `/api/learners/${f.learner.id}/progress` }),
    verify: (result, f) => {
      expect(result.body).toMatchObject({ learnerId: f.learner.id });
    },
  },
  {
    action: "Voir les épreuves à venir ou en retard d'un élève (tableau de bord du parent)",
    expected: {
      tutor: "allow",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "allow",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "GET", url: `/api/learners/${f.learner.id}/assignments` }),
    verify: (result) => {
      expect(Array.isArray((result.body as { assignments: unknown }).assignments)).toBe(true);
    },
  },
  {
    action: "Ajuster un niveau de compétence",
    expected: {
      tutor: "allow",
      linkedGuardian: "deny",
      unlinkedGuardian: "deny",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({
      method: "PUT",
      url: `/api/learners/${f.learner.id}/competencies/${f.competencyId}/level`,
      payload: { level: "acquired", justification: "Vu en séance, maîtrisé." },
    }),
  },
  {
    action: "Envoyer une suggestion",
    expected: {
      tutor: "deny",
      linkedGuardian: "allow",
      unlinkedGuardian: "n/a",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "deny",
    },
    request: () => ({
      method: "POST",
      url: "/api/suggestions",
      payload: { category: "other", body: "Merci !" },
    }),
  },
  {
    action: "Lire et traiter les suggestions (lecture)",
    expected: {
      tutor: "allow",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "GET", url: `/api/suggestions/${f.suggestionId}` }),
    verify: (result) => {
      expect(result.body).toMatchObject({ body: "Plus de géométrie, s'il vous plaît." });
    },
  },
  {
    action: "Lire et traiter les suggestions (traitement)",
    expected: {
      tutor: "allow",
      linkedGuardian: "deny",
      unlinkedGuardian: "deny",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({
      method: "PATCH",
      url: `/api/suggestions/${f.suggestionId}`,
      payload: { status: "read" },
    }),
  },
];

function cookieOf(f: Fixture, profile: Profile): string | undefined {
  switch (profile) {
    case "tutor":
      return f.tutor.cookie;
    case "linkedGuardian":
      return f.linkedGuardian;
    case "unlinkedGuardian":
      return f.unlinkedGuardian;
    case "learner":
      return f.learner.cookie;
    case "otherLearner":
      return f.otherLearner.cookie;
    case "anonymous":
      return undefined;
    case "otherSpaceTutor":
      return f.otherSpaceTutor;
  }
}

runRightsMatrix("Matrice des droits — progression et suggestions (R2, R15, R17)", rows, {
  create: () => World.create(),
  cookieOf,
  setup: async (world) => {
    const family = await setupFamily(world);
    const { competencyIds } = await mathsAndCompetencies(world, family.tutor.cookie);
    const sent = await world.http({
      method: "POST",
      url: "/api/suggestions",
      cookie: family.linkedGuardian,
      payload: { category: "lessons", body: "Plus de géométrie, s'il vous plaît." },
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    return {
      ...family,
      otherSpaceTutor: await setupOtherSpaceTutor(world),
      competencyId: competencyIds[0] ?? "",
      suggestionId: (sent.body as { id: string }).id,
    };
  },
});
