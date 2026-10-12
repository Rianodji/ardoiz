import { World } from "./support/world.js";
import { setupFamily, setupOtherSpaceTutor, type Family } from "./support/families.js";
import { setupProgramme, unlock, type Programme } from "./support/programme.js";
import { runRightsMatrix, type MatrixRow, type Profile } from "./support/rightsMatrix.js";

interface Fixture extends Family {
  readonly programme: Programme;
  readonly otherSpaceTutor: string;
  readonly domainId: string;
}

/**
 * Matrice des droits du programme (R2, R3) : le cours « Convertir des longueurs » est publié et
 * déverrouillé pour Lina SEULE. Noé (autre élève) et Bintou (parent non lié à Lina) ne doivent rien
 * apprendre de son existence ; le tuteur d'un autre espace non plus (R10).
 */
const tutorOnly = {
  tutor: "allow",
  linkedGuardian: "deny",
  unlinkedGuardian: "deny",
  learner: "deny",
  otherLearner: "deny",
  anonymous: "deny",
  otherSpaceTutor: "hide",
} as const;
const readLesson = {
  tutor: "allow",
  linkedGuardian: "allow",
  unlinkedGuardian: "hide",
  learner: "allow",
  otherLearner: "hide",
  anonymous: "deny",
  otherSpaceTutor: "hide",
} as const;

const rows: ReadonlyArray<MatrixRow<Fixture>> = [
  {
    action: "Créer, modifier ou publier un cours",
    expected: tutorOnly,
    request: (f) => ({
      method: "PATCH",
      url: `/api/lessons/${f.programme.lessonId}`,
      payload: { title: "Convertir des longueurs (révision)" },
    }),
  },
  {
    action: "Déverrouiller un contenu",
    expected: tutorOnly,
    request: (f) => ({
      method: "POST",
      url: "/api/unlocks",
      payload: {
        target: { kind: "lesson", id: f.programme.lessonId },
        audience: { kind: "learner", id: f.otherLearner.id },
      },
    }),
  },
  {
    action: "Gérer le référentiel de compétences",
    expected: tutorOnly,
    request: (f) => ({
      method: "POST",
      url: "/api/competencies",
      payload: { domainId: f.domainId, label: "Lire une échelle" },
    }),
  },
  {
    action: "Lire un cours",
    expected: readLesson,
    request: (f) => ({ method: "GET", url: `/api/lessons/${f.programme.lessonId}` }),
  },
  {
    action: "Lire un média (comme le cours qui le contient)",
    expected: readLesson,
    request: (f) => ({ method: "GET", url: `/api/media/${f.programme.mediaId}` }),
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

runRightsMatrix("Matrice des droits — curriculum (R2, R3)", rows, {
  create: () => World.create(),
  cookieOf,
  setup: async (world) => {
    const family = await setupFamily(world);
    const programme = await setupProgramme(world, family);
    await unlock(
      world,
      family.tutor.cookie,
      { kind: "lesson", id: programme.lessonId },
      { kind: "learner", id: family.learner.id },
    );
    const otherSpaceTutor = await setupOtherSpaceTutor(world);
    const referential = await world.http({
      method: "GET",
      url: "/api/referential",
      cookie: family.tutor.cookie,
    });
    const domainId =
      (referential.body as { domains: Array<{ id: string; prefix: string }> }).domains.find(
        (domain) => domain.prefix === "MES",
      )?.id ?? "";
    return { ...family, programme, otherSpaceTutor, domainId };
  },
});
