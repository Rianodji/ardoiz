import { expect } from "vitest";
import { LEARNER_PASSWORD, World } from "./support/world.js";
import { setupFamily, setupOtherSpaceTutor, type Family } from "./support/families.js";
import { runRightsMatrix, type MatrixRow, type Profile } from "./support/rightsMatrix.js";
import { currentConsentSync } from "./support/consent.js";

interface Fixture extends Family {
  readonly otherSpaceTutor: string;
  /** Lien de Moussa (co-parent) avec Lina : révocable sans retirer le dernier lien. */
  readonly coGuardianshipId: string;
  readonly consent: { accepted: true; version: string; sha256: string };
}

/**
 * Matrice des droits du module identity, cellule par cellule, contre le vrai serveur et une vraie base
 * (R2, R10, R12). Chaque cellule part d'une copie neuve de la même famille.
 */
const rows: ReadonlyArray<MatrixRow<Fixture>> = [
  {
    action: "Inviter un parent",
    expected: {
      tutor: "allow",
      linkedGuardian: "deny",
      unlinkedGuardian: "deny",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "n/a", // il invite dans SON espace : sans rapport avec celui-ci
    },
    request: () => ({ method: "POST", url: "/api/invitations", payload: { email: "nouveau@example.org" } }),
  },
  {
    action: "Créer un élève",
    expected: {
      tutor: "deny",
      linkedGuardian: "allow",
      unlinkedGuardian: "n/a", // « — » dans la matrice
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "n/a",
    },
    request: (f) => ({
      method: "POST",
      url: "/api/learners",
      payload: {
        firstName: "Sami",
        username: "sami",
        schoolLevel: "6e",
        password: LEARNER_PASSWORD,
        consent: f.consent,
      },
    }),
  },
  {
    action: "Inviter un co-parent pour un élève",
    expected: {
      tutor: "deny",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "deny",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({
      method: "POST",
      url: `/api/learners/${f.learner.id}/co-guardian-invitations`,
      payload: { email: "tonton@example.org" },
    }),
  },
  {
    action: "Révoquer un lien parental",
    expected: {
      tutor: "allow",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "deny",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "DELETE", url: `/api/guardianships/${f.coGuardianshipId}` }),
  },
  {
    action: "Réinitialiser le mot de passe d'un élève",
    expected: {
      tutor: "allow",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "deny",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({
      method: "POST",
      url: `/api/learners/${f.learner.id}/password`,
      payload: { password: "zebre-violet-9" },
    }),
  },
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
    request: (f) => ({ method: "GET", url: `/api/learners/${f.learner.id}` }),
  },
  {
    action: "Consulter le journal d'audit",
    expected: {
      tutor: "allow",
      linkedGuardian: "deny",
      unlinkedGuardian: "deny",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "n/a", // il consulte le journal de SON espace (vérifié par le test d'isolation)
    },
    request: () => ({ method: "GET", url: "/api/audit" }),
  },
  {
    action: "Retirer son consentement",
    expected: {
      tutor: "deny",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "deny",
      otherLearner: "deny",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "POST", url: `/api/learners/${f.learner.id}/consent-withdrawal` }),
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

runRightsMatrix("Matrice des droits — identity (R2)", rows, {
  create: () => World.create(),
  cookieOf,
  setup: async (world) => {
    const family = await setupFamily(world);
    const otherSpaceTutor = await setupOtherSpaceTutor(world);
    const profile = await world.http({
      method: "GET",
      url: `/api/learners/${family.learner.id}`,
      cookie: family.linkedGuardian,
    });
    const guardians = (profile.body as { guardians: Array<{ guardianshipId: string; displayName: string }> })
      .guardians;
    const coLink = guardians.find((guardian) => guardian.displayName === "Moussa");
    expect(coLink).toBeDefined();
    return {
      ...family,
      otherSpaceTutor,
      coGuardianshipId: coLink?.guardianshipId ?? "",
      consent: await currentConsentSync(world),
    };
  },
});
