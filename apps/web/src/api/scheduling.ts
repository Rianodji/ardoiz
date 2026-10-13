import type { OccurrenceView } from "@ardoiz/contracts";
import {
  AgendaResponse,
  IdResponse,
  JoinResponse,
  TutorSessionsResponse,
  type PlanSessionRequest,
} from "@ardoiz/contracts";
import type { Static } from "typebox";
import { apiFetch } from "./client";
import { empty, guard } from "./identity";

/** Client de la planification. Le lien de visio ne vient que de `join`, ou de la vue du tuteur (R9). */
const enc = encodeURIComponent;

export type Occurrence = Static<typeof OccurrenceView>;
export type PlanRequest = Static<typeof PlanSessionRequest>;

export const fetchAgenda = (from: string, days: number) =>
  apiFetch(`/api/agenda?from=${enc(from)}&days=${String(days)}`, guard(AgendaResponse));
export const joinOccurrence = (occurrenceId: string) =>
  apiFetch(`/api/occurrences/${enc(occurrenceId)}/join`, guard(JoinResponse), { method: "POST" });

export const fetchTutorSessions = () => apiFetch("/api/sessions", guard(TutorSessionsResponse));
export const planSession = (body: PlanRequest) =>
  apiFetch("/api/sessions", guard(IdResponse), { method: "POST", body });
export const changeSessionLink = (sessionId: string, link?: string) =>
  apiFetch(`/api/sessions/${enc(sessionId)}/link`, empty, {
    method: "PUT",
    body: link === undefined || link === "" ? {} : { link },
  });
export const moveOccurrence = (
  occurrenceId: string,
  body: { date: string; time: string; durationMinutes: number },
) => apiFetch(`/api/occurrences/${enc(occurrenceId)}`, empty, { method: "PATCH", body });
export const cancelOccurrence = (occurrenceId: string, wholeSeries: boolean) =>
  apiFetch(`/api/occurrences/${enc(occurrenceId)}/cancel`, empty, { method: "POST", body: { wholeSeries } });
