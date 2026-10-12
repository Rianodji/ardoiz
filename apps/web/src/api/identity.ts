import {
  AcceptedResponse,
  AuditResponse,
  FamiliesResponse,
  InvitationView,
  LearnersResponse,
  LearnerView,
  LegalDocumentResponse,
  LoginResponse,
  MeResponse,
  RecoveryCodesResponse,
  SessionsResponse,
  TotpEnrollmentResponse,
} from "@ardoiz/contracts";
import type { TSchema, Static } from "typebox";
import { Check } from "typebox/value";
import { apiFetch, ApiError, type ResponseGuard } from "./client";

/** Garde de type à partir d'un schéma du contrat : la réponse du serveur est vérifiée, pas supposée. */
function guard<S extends TSchema>(schema: S): ResponseGuard<Static<S>> {
  return (value: unknown): value is Static<S> => Check(schema, value);
}
const empty: ResponseGuard<null> = (value: unknown): value is null => value === null || value === undefined;

export type LegalDocument = "mentions-legales" | "confidentialite" | "confidentialite-eleve" | "consentement";
export type Consent = { accepted: true; version: string; sha256: string };

/** Moi, si une session complète existe ; null sinon (401). */
export async function fetchMe(): Promise<Static<typeof MeResponse> | null> {
  try {
    return await apiFetch("/api/me", guard(MeResponse));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const loginAdult = (email: string, password: string) =>
  apiFetch("/api/auth/login/adult", guard(LoginResponse), { method: "POST", body: { email, password } });
export const loginLearner = (spaceCode: string, username: string, password: string) =>
  apiFetch("/api/auth/login/learner", guard(LoginResponse), {
    method: "POST",
    body: { spaceCode, username, password },
  });
export const verifyTotp = (code: string) =>
  apiFetch("/api/auth/totp/verify", guard(LoginResponse), { method: "POST", body: { code } });
export const logout = () => apiFetch("/api/auth/logout", empty, { method: "POST" });
export const startTotpEnrollment = () =>
  apiFetch("/api/auth/totp/enroll", guard(TotpEnrollmentResponse), { method: "POST" });
export const activateTotp = (code: string) =>
  apiFetch("/api/auth/totp/activate", guard(RecoveryCodesResponse), { method: "POST", body: { code } });
export const reauthenticate = (password: string, totpCode?: string) =>
  apiFetch("/api/auth/reauthenticate", empty, {
    method: "POST",
    body: totpCode === undefined || totpCode === "" ? { password } : { password, totpCode },
  });
export const fetchSessions = () => apiFetch("/api/auth/sessions", guard(SessionsResponse));
export const revokeSession = (id: string) =>
  apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, empty, { method: "DELETE" });

export const requestPasswordReset = (email: string) =>
  apiFetch("/api/auth/password-reset/request", guard(AcceptedResponse), {
    method: "POST",
    body: { email },
  });
export const completePasswordReset = (token: string, password: string) =>
  apiFetch("/api/auth/password-reset/complete", empty, { method: "POST", body: { token, password } });

export const inspectInvitation = (token: string) =>
  apiFetch("/api/invitations/inspect", guard(InvitationView), { method: "POST", body: { token } });
export const acceptInvitation = (body: {
  token: string;
  password: string;
  displayName?: string;
  consent: Consent;
}) => apiFetch("/api/invitations/accept", guard(LoginResponse), { method: "POST", body });
export const inviteGuardian = (email: string) =>
  apiFetch("/api/invitations", guard(AcceptedResponse), { method: "POST", body: { email } });

export const fetchFamilies = () => apiFetch("/api/families", guard(FamiliesResponse));
export const fetchMyLearners = () => apiFetch("/api/learners", guard(LearnersResponse));
export const fetchLearner = (id: string) =>
  apiFetch(`/api/learners/${encodeURIComponent(id)}`, guard(LearnerView));
export const createLearner = (body: {
  firstName: string;
  username: string;
  schoolLevel: string;
  password: string;
  consent: Consent;
}) =>
  apiFetch(
    "/api/learners",
    (v: unknown): v is { learnerId: string } => typeof v === "object" && v !== null && "learnerId" in v,
    {
      method: "POST",
      body,
    },
  );
export const resetLearnerPassword = (learnerId: string, password: string) =>
  apiFetch(`/api/learners/${encodeURIComponent(learnerId)}/password`, empty, {
    method: "POST",
    body: { password },
  });
export const inviteCoGuardian = (learnerId: string, email: string) =>
  apiFetch(
    `/api/learners/${encodeURIComponent(learnerId)}/co-guardian-invitations`,
    guard(AcceptedResponse),
    {
      method: "POST",
      body: { email },
    },
  );
export const withdrawConsent = (learnerId: string) =>
  apiFetch(`/api/learners/${encodeURIComponent(learnerId)}/consent-withdrawal`, empty, { method: "POST" });
export const revokeGuardianship = (guardianshipId: string) =>
  apiFetch(`/api/guardianships/${encodeURIComponent(guardianshipId)}`, empty, { method: "DELETE" });
export const fetchAudit = () => apiFetch("/api/audit", guard(AuditResponse));

export const fetchLegal = (document: LegalDocument) =>
  apiFetch(`/api/legal/${document}`, guard(LegalDocumentResponse));
