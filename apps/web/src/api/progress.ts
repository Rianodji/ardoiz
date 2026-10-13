import {
  IdResponse,
  LearnerAssignmentsResponse,
  LearnerProgressResponse,
  ProgressOverviewResponse,
  SuggestionsResponse,
  type AdjustLevelRequest,
} from "@ardoiz/contracts";
import type { Static } from "typebox";
import { apiFetch } from "./client";
import { empty, guard } from "./identity";

/** Client de la progression et des suggestions. Les réponses sont vérifiées par des schémas FERMÉS. */
const enc = encodeURIComponent;

export type LearnerProgress = Static<typeof LearnerProgressResponse>;
export type ProgressOverview = Static<typeof ProgressOverviewResponse>;
export type Suggestion = Static<typeof SuggestionsResponse>["suggestions"][number];
export type AdjustableLevel = Static<typeof AdjustLevelRequest>["level"];

export const fetchProgress = (learnerId: string) =>
  apiFetch(`/api/learners/${enc(learnerId)}/progress`, guard(LearnerProgressResponse));
export const fetchLearnerAssignments = (learnerId: string) =>
  apiFetch(`/api/learners/${enc(learnerId)}/assignments`, guard(LearnerAssignmentsResponse));
export const fetchOverview = () => apiFetch("/api/progress/overview", guard(ProgressOverviewResponse));
export const adjustLevel = (
  learnerId: string,
  competencyId: string,
  level: AdjustableLevel,
  justification: string,
) =>
  apiFetch(`/api/learners/${enc(learnerId)}/competencies/${enc(competencyId)}/level`, empty, {
    method: "PUT",
    body: { level, justification },
  });

export const fetchSuggestions = () => apiFetch("/api/suggestions", guard(SuggestionsResponse));
export const sendSuggestion = (category: Suggestion["category"], body: string) =>
  apiFetch("/api/suggestions", guard(IdResponse), { method: "POST", body: { category, body } });
export const handleSuggestion = (suggestionId: string, status: "read" | "done", reply: string) =>
  apiFetch(`/api/suggestions/${enc(suggestionId)}`, empty, {
    method: "PATCH",
    body: reply.trim() === "" ? { status } : { status, reply },
  });
