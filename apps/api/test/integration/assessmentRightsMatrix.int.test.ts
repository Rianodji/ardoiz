import {
  assign,
  createAssessment,
  mcqTwelve,
  optionWithText,
  startAttempt,
  type LearnerAttempt,
} from "./support/assessment.js";
import { setupFamily, setupOtherSpaceTutor, type Family } from "./support/families.js";
import { runRightsMatrix, type MatrixRow, type Profile } from "./support/rightsMatrix.js";
import { World } from "./support/world.js";

interface Fixture extends Family {
  readonly otherSpaceTutor: string;
  readonly assessmentId: string;
  /** Attribution ouverte à Lina, sans tentative. */
  readonly openAssignmentId: string;
  /** Copie de Lina rendue et publiée. */
  readonly publishedAttemptId: string;
  /** Copie de Lina rendue, en attente de correction manuelle (réponse courte). */
  readonly pendingAttemptId: string;
  readonly pendingQuestionId: string;
}

/**
 * Matrice des droits de l'évaluation (R2, R5) : Lina est l'élève concernée par les attributions ;
 * Noé (autre élève) et Bintou (parent non lié) ne doivent rien apprendre de ses copies.
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
const publishedCopy = {
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
    action: "Créer, modifier ou publier une épreuve",
    expected: tutorOnly,
    request: (f) => ({ method: "GET", url: `/api/assessments/${f.assessmentId}` }),
  },
  {
    action: "Attribuer une épreuve",
    expected: tutorOnly,
    request: (f) => ({
      method: "POST",
      url: "/api/assignments",
      payload: {
        assessmentId: f.assessmentId,
        audience: { kind: "learner", id: f.otherLearner.id },
        opensAt: "2026-10-12T07:00:00.000Z",
        dueAt: "2026-10-16T16:00:00.000Z",
        maxAttempts: 1,
        lateAllowed: false,
        publication: "manual",
      },
    }),
  },
  {
    action: "Commencer une tentative, enregistrer un brouillon, rendre",
    expected: {
      tutor: "deny",
      linkedGuardian: "deny",
      unlinkedGuardian: "hide",
      learner: "allow",
      otherLearner: "hide",
      anonymous: "deny",
      otherSpaceTutor: "hide",
    },
    request: (f) => ({ method: "POST", url: `/api/my/assignments/${f.openAssignmentId}/attempt` }),
  },
  {
    action: "Voir une copie rendue",
    expected: publishedCopy,
    request: (f) => ({ method: "GET", url: `/api/attempts/${f.publishedAttemptId}` }),
  },
  {
    // QUESTION Q17 : avant publication, la matrice ne dit rien pour le parent lié ; option restrictive : 👻.
    action: "Voir une copie rendue (avant publication)",
    expected: { ...publishedCopy, linkedGuardian: "hide" },
    request: (f) => ({ method: "GET", url: `/api/attempts/${f.pendingAttemptId}` }),
  },
  {
    action: "Voir le corrigé d'une épreuve",
    expected: publishedCopy,
    request: (f) => ({ method: "GET", url: `/api/learners/${f.learner.id}/results` }),
  },
  {
    action: "Corriger, annoter, publier, rectifier une note",
    expected: tutorOnly,
    request: (f) => ({
      method: "POST",
      url: `/api/grading/attempts/${f.pendingAttemptId}/grades`,
      payload: { grades: [{ questionId: f.pendingQuestionId, earned: 1, comment: "Bien expliqué." }] },
    }),
  },
  {
    action: "Corriger, annoter, publier, rectifier une note (file de correction)",
    // Le tuteur d'un autre espace lit SA file, vide : rien du premier espace n'y paraît (R10).
    expected: { ...tutorOnly, otherSpaceTutor: "allow" },
    request: () => ({ method: "GET", url: "/api/grading/attempts" }),
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

async function submitted(
  world: World,
  family: Family,
  assignmentId: string,
  answers: (attempt: LearnerAttempt) => object,
): Promise<LearnerAttempt> {
  const attempt = (await startAttempt(world, family.learner.cookie, assignmentId)).body as LearnerAttempt;
  const res = await world.http({
    method: "POST",
    url: `/api/attempts/${attempt.attemptId}/submit`,
    cookie: family.learner.cookie,
    payload: { answers: answers(attempt) },
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return attempt;
}

runRightsMatrix("Matrice des droits — évaluation (R2, R5)", rows, {
  create: () => World.create(),
  cookieOf,
  setup: async (world) => {
    const family = await setupFamily(world);
    const tutor = family.tutor.cookie;
    const lina = family.learner.id;
    const { assessmentId } = await createAssessment(world, tutor, "Arithmétique 1", ([c = ""]) => [
      mcqTwelve(c),
    ]);
    const published = await assign(world, tutor, assessmentId, { learnerId: lina, publication: "auto" });
    const publishedAttempt = await submitted(world, family, published, (attempt) => ({
      [attempt.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [optionWithText(attempt, 0, "12")] },
    }));
    const { assessmentId: writtenId } = await createAssessment(world, tutor, "Rédaction", ([c = ""]) => [
      { kind: "short_text", prompt: "Explique la méthode.", points: 2, competencyIds: [c] },
    ]);
    const pending = await assign(world, tutor, writtenId, { learnerId: lina });
    const pendingAttempt = await submitted(world, family, pending, (attempt) => ({
      [attempt.questions[0]?.id ?? ""]: { kind: "short_text", text: "On multiplie." },
    }));
    const openAssignmentId = await assign(world, tutor, assessmentId, { learnerId: lina });
    return {
      ...family,
      otherSpaceTutor: await setupOtherSpaceTutor(world),
      assessmentId,
      openAssignmentId,
      publishedAttemptId: publishedAttempt.attemptId,
      pendingAttemptId: pendingAttempt.attemptId,
      pendingQuestionId: pendingAttempt.questions[0]?.id ?? "",
    };
  },
});
