import { expect } from "vitest";
import { nextTotp, SPACE_CODE, type Family } from "./families.js";
import { ADULT_PASSWORD, cookieFrom, LEARNER_PASSWORD, type HttpResult, type World } from "./world.js";

/** Lundi 12 octobre 2026, 9 h à Paris (UTC+2) ; vendredi 16 octobre, 18 h. */
export const MONDAY_9H = new Date("2026-10-12T07:00:00Z");
export const FRIDAY_18H = new Date("2026-10-16T16:00:00Z");

/** Après un saut d'horloge, les sessions ont expiré (R8) : on se reconnecte. */
export async function loginLearner(world: World, username: string): Promise<string> {
  const login = await world.http({
    method: "POST",
    url: "/api/auth/login/learner",
    payload: { spaceCode: SPACE_CODE, username, password: LEARNER_PASSWORD },
  });
  expect(login.status).toBe(200);
  return cookieFrom(login.setCookie);
}

export async function loginGuardian(world: World, email: string): Promise<string> {
  const login = await world.http({
    method: "POST",
    url: "/api/auth/login/adult",
    payload: { email, password: ADULT_PASSWORD },
  });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return cookieFrom(login.setCookie);
}

/** Connexion du tuteur avec son second facteur ; avance l'horloge de 30 s (pas TOTP neuf). */
export async function loginTutor(world: World, family: Family): Promise<string> {
  const login = await world.http({
    method: "POST",
    url: "/api/auth/login/adult",
    payload: { email: family.tutor.email, password: ADULT_PASSWORD },
  });
  const cookie = cookieFrom(login.setCookie);
  const verified = await world.http({
    method: "POST",
    url: "/api/auth/totp/verify",
    cookie,
    payload: { code: nextTotp(world, family.tutor.totpSecret) },
  });
  expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  return verified.setCookie === undefined ? cookie : cookieFrom(verified.setCookie);
}

export interface QuestionPayload {
  readonly kind: "mcq" | "numeric" | "short_text" | "notebook";
  readonly [key: string]: unknown;
}

export interface AssessmentSetup {
  readonly assessmentId: string;
  readonly subjectId: string;
  readonly competencyIds: readonly string[];
}

/** Matière « Mathématiques » et deux compétences actives du référentiel. */
export async function mathsAndCompetencies(
  world: World,
  tutor: string,
): Promise<{ subjectId: string; competencyIds: string[] }> {
  const referential = (await world.http({ method: "GET", url: "/api/referential", cookie: tutor })).body as {
    subjects: Array<{ id: string; name: string }>;
  };
  const choices = (await world.http({ method: "GET", url: "/api/competencies", cookie: tutor })).body as {
    competencies: Array<{ id: string }>;
  };
  return {
    subjectId: referential.subjects.find((subject) => subject.name === "Mathématiques")?.id ?? "",
    competencyIds: choices.competencies.slice(0, 2).map((competency) => competency.id),
  };
}

/** QCM « 3 × 4 = ? » : la bonne réponse est « 12 ». */
export const mcqTwelve = (competencyId: string): QuestionPayload => ({
  kind: "mcq",
  prompt: "Combien font 3 × 4 ?",
  points: 2,
  competencyIds: [competencyId],
  options: [{ text: "7" }, { text: "12" }, { text: "34" }, { text: "1" }],
  correctOptions: [1],
  explanation: "3 × 4 = 4 + 4 + 4 = 12.",
});

export async function createAssessment(
  world: World,
  tutor: string,
  title: string,
  questions: (competencyIds: readonly string[]) => QuestionPayload[],
): Promise<AssessmentSetup> {
  const { subjectId, competencyIds } = await mathsAndCompetencies(world, tutor);
  const created = await world.http({
    method: "POST",
    url: "/api/assessments",
    cookie: tutor,
    payload: { subjectId, title },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const assessmentId = (created.body as { id: string }).id;
  const saved = await world.http({
    method: "PUT",
    url: `/api/assessments/${assessmentId}/questions`,
    cookie: tutor,
    payload: { questions: questions(competencyIds) },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(204);
  return { assessmentId, subjectId, competencyIds };
}

export interface AssignmentOptions {
  readonly learnerId?: string;
  readonly groupId?: string;
  readonly opensAt?: Date;
  readonly dueAt?: Date;
  readonly maxAttempts?: number;
  readonly lateAllowed?: boolean;
  readonly publication?: "auto" | "manual";
}

export async function assign(
  world: World,
  tutor: string,
  assessmentId: string,
  options: AssignmentOptions,
): Promise<string> {
  const res = await world.http({
    method: "POST",
    url: "/api/assignments",
    cookie: tutor,
    payload: {
      assessmentId,
      audience:
        options.groupId === undefined
          ? { kind: "learner", id: options.learnerId }
          : { kind: "group", id: options.groupId },
      opensAt: (options.opensAt ?? MONDAY_9H).toISOString(),
      dueAt: (options.dueAt ?? FRIDAY_18H).toISOString(),
      maxAttempts: options.maxAttempts ?? 1,
      lateAllowed: options.lateAllowed ?? false,
      publication: options.publication ?? "manual",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

export interface LearnerAttempt {
  readonly attemptId: string;
  readonly status: string;
  readonly number: number;
  readonly questions: Array<{
    id: string;
    kind: string;
    options?: Array<{ id: string; text: string }>;
    units?: string[];
  }>;
  readonly correction: { grade: number } | null;
}

export const startAttempt = (world: World, cookie: string, assignmentId: string): Promise<HttpResult> =>
  world.http({ method: "POST", url: `/api/my/assignments/${assignmentId}/attempt`, cookie });

/** Identifiant opaque de l'option affichée avec ce texte, pour CETTE tentative. */
export function optionWithText(attempt: LearnerAttempt, questionIndex: number, text: string): string {
  const option = attempt.questions[questionIndex]?.options?.find((candidate) => candidate.text === text);
  if (option === undefined) throw new Error(`Option absente : ${text}`);
  return option.id;
}
