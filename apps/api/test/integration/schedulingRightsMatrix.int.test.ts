import { expect } from "vitest";
import { setupFamily, setupOtherSpaceTutor, type Family } from "./support/families.js";
import { runRightsMatrix, type MatrixRow, type Profile } from "./support/rightsMatrix.js";
import { plannedSession } from "./support/scheduling.js";
import { World } from "./support/world.js";

interface Fixture extends Family {
  readonly otherSpaceTutor: string;
  /** Séance de Lina qui commence dans 10 min : la fenêtre du lien est ouverte (R9). */
  readonly occurrenceId: string;
}

/**
 * Matrice des droits de la planification (R2, R9) : Lina participe ; Noé et Bintou (parent non lié)
 * ne doivent rien apprendre de la séance ; le parent lié voit la séance mais jamais le lien.
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

const rows: ReadonlyArray<MatrixRow<Fixture>> = [
  {
    action: "Planifier, déplacer, annuler une séance",
    expected: tutorOnly,
    request: (f) => ({
      method: "PATCH",
      url: `/api/occurrences/${f.occurrenceId}`,
      payload: { date: "2026-10-20", time: "17:00", durationMinutes: 60 },
    }),
  },
  {
    action: "Planifier, déplacer, annuler une séance (annulation)",
    expected: tutorOnly,
    request: (f) => ({
      method: "POST",
      url: `/api/occurrences/${f.occurrenceId}/cancel`,
      payload: { wholeSeries: false },
    }),
  },
  {
    action: "Voir une séance (sans lien)",
    expected: {
      tutor: "allow",
      linkedGuardian: "allow",
      unlinkedGuardian: "hide",
      learner: "allow",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "GET", url: `/api/occurrences/${f.occurrenceId}` }),
    verify: (result) => {
      expect(result.body).toMatchObject({ title: "Séance de mathématiques" });
    },
  },
  {
    action: "Obtenir le lien de visio",
    expected: {
      tutor: "allow",
      linkedGuardian: "deny",
      unlinkedGuardian: "hide",
      learner: "allow",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "POST", url: `/api/occurrences/${f.occurrenceId}/join` }),
    verify: (result) => {
      expect(result.body).toEqual({ meetingLink: "https://meet.jit.si/ardoiz-matrice" });
    },
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

/** Heure de Paris arrondie aux 5 minutes supérieures, `minutes` après l'horloge du monde. */
function parisIn(world: World, minutes: number): { date: string; time: string } {
  const instant = new Date(Math.ceil((world.clock.now().getTime() + minutes * 60_000) / 300_000) * 300_000);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  const [date = "", time = ""] = parts.split(" ");
  return { date, time };
}

runRightsMatrix("Matrice des droits — planification (R2, R9)", rows, {
  create: () => World.create(),
  cookieOf,
  setup: async (world) => {
    const family = await setupFamily(world);
    const otherSpaceTutor = await setupOtherSpaceTutor(world);
    const session = await plannedSession(world, family.tutor.cookie, {
      learnerId: family.learner.id,
      ...parisIn(world, 10),
      link: "https://meet.jit.si/ardoiz-matrice",
    });
    return { ...family, otherSpaceTutor, occurrenceId: session.occurrences[0]?.occurrenceId ?? "" };
  },
});
