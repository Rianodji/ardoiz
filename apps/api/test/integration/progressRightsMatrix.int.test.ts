import { expect } from "vitest";
import { mathsAndCompetencies } from "./support/assessment.js";
import { setupFamily, setupOtherSpaceTutor, type Family } from "./support/families.js";
import { runRightsMatrix, type MatrixRow, type Profile } from "./support/rightsMatrix.js";
import { World } from "./support/world.js";

interface Fixture extends Family {
  readonly otherSpaceTutor: string;
  readonly competencyId: string;
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

runRightsMatrix("Matrice des droits — progression (R2, R17)", rows, {
  create: () => World.create(),
  cookieOf,
  setup: async (world) => {
    const family = await setupFamily(world);
    const { competencyIds } = await mathsAndCompetencies(world, family.tutor.cookie);
    return {
      ...family,
      otherSpaceTutor: await setupOtherSpaceTutor(world),
      competencyId: competencyIds[0] ?? "",
    };
  },
});
