import type { AuthorAssessmentResponse } from "@ardoiz/contracts";
import {
  AssignmentsResponse,
  AuthorAssessmentsResponse,
  GradingQueueResponse,
  IdResponse,
  LearnerAssignmentsResponse,
  LearnerAttemptResponse,
  PublishedResultsResponse,
  TutorAttemptResponse,
  type AssignmentRequest,
  type LearnerAnswer,
  type QuestionRequest,
} from "@ardoiz/contracts";
import type { Static } from "typebox";
import { apiFetch } from "./client";
import { empty, guard } from "./identity";

/**
 * Client de l'évaluation. Les réponses de l'élève sont vérifiées par des schémas FERMÉS : un champ
 * inattendu (une réponse attendue, par exemple) fait rejeter la réponse au lieu de l'afficher (R5).
 */
const path = (template: string, id: string) => template.replace(":id", encodeURIComponent(id));

export type LearnerAttempt = Static<typeof LearnerAttemptResponse>;
export type Answer = Static<typeof LearnerAnswer>;
export type QuestionInput = Static<typeof QuestionRequest>;
export type AuthorAssessment = Static<typeof AuthorAssessmentResponse>;
export type TutorAttempt = Static<typeof TutorAttemptResponse>;

// --- Élève ---------------------------------------------------------------------------------------
export const fetchMyAssignments = () => apiFetch("/api/my/assignments", guard(LearnerAssignmentsResponse));
export const startAttempt = (assignmentId: string) =>
  apiFetch(path("/api/my/assignments/:id/attempt", assignmentId), guard(LearnerAttemptResponse), {
    method: "POST",
  });
export const fetchAttempt = (attemptId: string) =>
  apiFetch(path("/api/attempts/:id", attemptId), guard(LearnerAttemptResponse));
export const saveDraft = (attemptId: string, answers: Record<string, Answer>) =>
  apiFetch(path("/api/attempts/:id/answers", attemptId), empty, { method: "PUT", body: { answers } });
export const submitAttempt = (attemptId: string, answers: Record<string, Answer>) =>
  apiFetch(path("/api/attempts/:id/submit", attemptId), guard(LearnerAttemptResponse), {
    method: "POST",
    body: { answers },
  });
export const fetchPublishedResults = (learnerId: string) =>
  apiFetch(path("/api/learners/:id/results", learnerId), guard(PublishedResultsResponse));

// --- Tuteur --------------------------------------------------------------------------------------
export const fetchAssessments = () => apiFetch("/api/assessments", guard(AuthorAssessmentsResponse));
export const createAssessment = (subjectId: string, title: string) =>
  apiFetch("/api/assessments", guard(IdResponse), { method: "POST", body: { subjectId, title } });
export const saveQuestions = (assessmentId: string, questions: QuestionInput[]) =>
  apiFetch(path("/api/assessments/:id/questions", assessmentId), empty, {
    method: "PUT",
    body: { questions },
  });
export const fetchAssignments = () => apiFetch("/api/assignments", guard(AssignmentsResponse));
export const assignAssessment = (body: Static<typeof AssignmentRequest>) =>
  apiFetch("/api/assignments", guard(IdResponse), { method: "POST", body });
export const fetchGradingQueue = () => apiFetch("/api/grading/attempts", guard(GradingQueueResponse));
export const fetchTutorAttempt = (attemptId: string) =>
  apiFetch(path("/api/grading/attempts/:id", attemptId), guard(TutorAttemptResponse));
export const gradeAttempt = (
  attemptId: string,
  grades: Array<{ questionId: string; earned: number; comment?: string }>,
) =>
  apiFetch(path("/api/grading/attempts/:id/grades", attemptId), empty, { method: "POST", body: { grades } });
export const publishAttempt = (attemptId: string) =>
  apiFetch(path("/api/grading/attempts/:id/publish", attemptId), empty, { method: "POST" });
export const rectifyGrade = (
  attemptId: string,
  body: { questionId: string; earned: number; reason: string },
) => apiFetch(path("/api/grading/attempts/:id/rectifications", attemptId), empty, { method: "POST", body });
