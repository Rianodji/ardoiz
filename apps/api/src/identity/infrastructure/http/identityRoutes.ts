import {
  AcceptedResponse,
  AcceptInvitationRequest,
  AdultLoginRequest,
  AuditResponse,
  CreatedLearnerResponse,
  CreateLearnerRequest,
  FamiliesResponse,
  InvitationTokenRequest,
  InvitationView,
  InviteRequest,
  LEGAL_DOCUMENTS,
  LearnerLoginRequest,
  LearnersResponse,
  LearnerView,
  LegalDocumentResponse,
  LoginResponse,
  MeResponse,
  NewPasswordRequest,
  PasswordResetCompletion,
  PasswordResetRequest,
  ReauthenticateRequest,
  RecoveryCodesResponse,
  SessionsResponse,
  TotpCodeRequest,
  TotpEnrollmentResponse,
} from "@ardoiz/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type, type Static } from "typebox";
import { shortUserAgent, truncateIp } from "../../../platform/http/clientAddress.js";
import { AuthSessionId, GuardianshipId, LearnerId } from "../../../shared-kernel/ids.js";
import type { AuditQuery } from "../../application/AuditQuery.js";
import type { AuthService, ClientContext, LoginResult } from "../../application/AuthService.js";
import type { FamilyService, LearnerView as LearnerModel } from "../../application/FamilyService.js";
import type { MfaService } from "../../application/MfaService.js";
import type { PasswordResetService } from "../../application/PasswordResetService.js";
import type { IdentityGateway } from "../../application/ports.js";
import type { LegalTexts } from "../LegalTexts.js";
import { actorOf, clearSessionCookie, sessionTokenOf, setSessionCookie } from "./authentication.js";

export interface IdentityHttpServices {
  readonly auth: AuthService;
  readonly mfa: MfaService;
  readonly families: FamilyService;
  readonly passwordResets: PasswordResetService;
  readonly audit: AuditQuery;
  readonly legal: LegalTexts;
  readonly gateway: IdentityGateway;
}

/** Statut HTTP des codes d'erreur d'identity (ajoutés au gestionnaire d'erreurs). */
export const IDENTITY_STATUSES: Readonly<Record<string, number>> = {
  "identity.invalid-credentials": 401,
  "identity.invalid-totp": 401,
  "identity.mfa-enrollment-required": 403,
  "identity.reauthentication-required": 403,
  "identity.email-taken": 409,
  "identity.username-taken": 409,
  "identity.space-code-taken": 409,
  "identity.last-guardianship": 409,
  "identity.mfa-unavailable": 409,
};

/**
 * Durée minimale des réponses de connexion et de mot de passe oublié : quelle que soit la cause
 * (compte inconnu, mauvais mot de passe, e-mail envoyé ou non), la réponse arrive au même moment (R8).
 */
export const MINIMUM_AUTH_RESPONSE_MS = 600;

async function atLeast<T>(milliseconds: number, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const settle = async () => {
    const remaining = milliseconds - (performance.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  };
  try {
    const result = await work();
    await settle();
    return result;
  } catch (error) {
    await settle();
    throw error;
  }
}

function clientOf(request: FastifyRequest): ClientContext {
  return {
    ip: request.ip,
    ipPrefix: truncateIp(request.ip),
    userAgent: shortUserAgent(request.headers["user-agent"]),
  };
}

function loginStatus(result: LoginResult): Static<typeof LoginResponse> {
  if (result.mfaPending) return { status: "mfa-required" };
  if (result.mfaEnrollmentRequired) return { status: "mfa-enrollment-required" };
  return { status: "authenticated" };
}

function learnerView(view: LearnerModel): Static<typeof LearnerView> {
  return { ...view, guardians: view.guardians.map((guardian) => ({ ...guardian })) };
}

const LearnerParams = Type.Object(
  { learnerId: Type.String({ maxLength: 60 }) },
  { additionalProperties: false },
);
const GuardianshipParams = Type.Object(
  { guardianshipId: Type.String({ maxLength: 60 }) },
  { additionalProperties: false },
);
const SessionParams = Type.Object(
  { sessionId: Type.String({ maxLength: 60 }) },
  { additionalProperties: false },
);
const LegalParams = Type.Object(
  { document: Type.Union(LEGAL_DOCUMENTS.map((document) => Type.Literal(document))) },
  { additionalProperties: false },
);

/** Routes HTTP du module identity. Chaque corps et chaque paramètre ont un schéma fermé (règle 5). */
export function identityRoutes(app: FastifyInstance, services: IdentityHttpServices): void {
  const { auth, mfa, families, passwordResets, audit, legal } = services;

  // --- Connexion (publique) -------------------------------------------------------------
  app.post<{ Body: Static<typeof AdultLoginRequest> }>(
    "/api/auth/login/adult",
    { config: { access: "public" }, schema: { body: AdultLoginRequest, response: { 200: LoginResponse } } },
    async (request, reply) => {
      const result = await atLeast(MINIMUM_AUTH_RESPONSE_MS, () =>
        auth.loginAdult(request.body, clientOf(request)),
      );
      await rotate(request);
      setSessionCookie(reply, result.sessionToken);
      return loginStatus(result);
    },
  );

  app.post<{ Body: Static<typeof LearnerLoginRequest> }>(
    "/api/auth/login/learner",
    { config: { access: "public" }, schema: { body: LearnerLoginRequest, response: { 200: LoginResponse } } },
    async (request, reply) => {
      const result = await atLeast(MINIMUM_AUTH_RESPONSE_MS, () =>
        auth.loginLearner(request.body, clientOf(request)),
      );
      await rotate(request);
      setSessionCookie(reply, result.sessionToken);
      return loginStatus(result);
    },
  );

  /** Rotation à la connexion (R8) : la session précédente du navigateur est révoquée. */
  const rotate = async (request: FastifyRequest): Promise<void> => {
    const previous = sessionTokenOf(request);
    if (previous !== undefined) await auth.logout(previous);
  };

  app.post<{ Body: Static<typeof TotpCodeRequest> }>(
    "/api/auth/totp/verify",
    {
      config: { access: "mfa-pending" },
      schema: { body: TotpCodeRequest, response: { 200: LoginResponse } },
    },
    async (request) => {
      const token = sessionTokenOf(request);
      if (token === undefined) throw new Error("Session absente après authentification.");
      await auth.verifyMfa(token, request.body.code);
      return { status: "authenticated" as const };
    },
  );

  app.post("/api/auth/logout", { config: { access: "mfa-pending" } }, async (request, reply) => {
    const token = sessionTokenOf(request);
    if (token !== undefined) await auth.logout(token);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // --- Profil, sessions, TOTP (enrôlement permis au tuteur sans TOTP, R7) ------------------
  app.get(
    "/api/me",
    { config: { access: "enrollment" }, schema: { response: { 200: MeResponse } } },
    async (request) => {
      const actor = actorOf(request);
      const name = await services.gateway.inSpace(actor.tutorSpaceId, async (store) => {
        const account = await store.accountById(actor.id);
        if (account === null) return "";
        return account.role === "learner" ? account.firstName : account.displayName;
      });
      return {
        kind: actor.kind,
        id: actor.id,
        name,
        mfaEnrolled: actor.kind === "learner" ? false : actor.mfaEnrolled,
      };
    },
  );

  app.get(
    "/api/auth/sessions",
    { config: { access: "enrollment" }, schema: { response: { 200: SessionsResponse } } },
    async (request) => {
      const actor = actorOf(request);
      const sessions = await auth.listSessions(actor);
      return {
        sessions: sessions.map((session) => ({
          id: session.id,
          current: session.id === actor.sessionId,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          userAgent: session.userAgent,
        })),
      };
    },
  );

  app.delete<{ Params: Static<typeof SessionParams> }>(
    "/api/auth/sessions/:sessionId",
    { config: { access: "enrollment" }, schema: { params: SessionParams } },
    async (request, reply) => {
      await auth.revokeSession(actorOf(request), AuthSessionId(request.params.sessionId));
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/auth/totp/enroll",
    { config: { access: "enrollment" }, schema: { response: { 200: TotpEnrollmentResponse } } },
    async (request) => mfa.startEnrollment(actorOf(request)),
  );

  app.post<{ Body: Static<typeof TotpCodeRequest> }>(
    "/api/auth/totp/activate",
    {
      config: { access: "enrollment" },
      schema: { body: TotpCodeRequest, response: { 200: RecoveryCodesResponse } },
    },
    async (request) => mfa.activate(actorOf(request), request.body.code),
  );

  app.post<{ Body: Static<typeof ReauthenticateRequest> }>(
    "/api/auth/reauthenticate",
    { config: { access: "enrollment" }, schema: { body: ReauthenticateRequest } },
    async (request, reply) => {
      const { password, totpCode } = request.body;
      await auth.reauthenticate(
        actorOf(request),
        totpCode === undefined ? { password } : { password, totpCode },
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/auth/totp/recovery-codes",
    { schema: { response: { 200: RecoveryCodesResponse } } },
    async (request) => mfa.regenerateRecoveryCodes(actorOf(request)),
  );

  // --- Mot de passe oublié (adultes, public) ----------------------------------------------
  app.post<{ Body: Static<typeof PasswordResetRequest> }>(
    "/api/auth/password-reset/request",
    {
      config: { access: "public" },
      schema: { body: PasswordResetRequest, response: { 202: AcceptedResponse } },
    },
    async (request, reply) => {
      await atLeast(MINIMUM_AUTH_RESPONSE_MS, () => passwordResets.request(request.body.email));
      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.post<{ Body: Static<typeof PasswordResetCompletion> }>(
    "/api/auth/password-reset/complete",
    { config: { access: "public" }, schema: { body: PasswordResetCompletion } },
    async (request, reply) => {
      await passwordResets.complete(request.body.token, request.body.password);
      return reply.code(204).send();
    },
  );

  // --- Invitations ----------------------------------------------------------------------
  app.post<{ Body: Static<typeof InviteRequest> }>(
    "/api/invitations",
    { schema: { body: InviteRequest, response: { 202: AcceptedResponse } } },
    async (request, reply) => {
      await families.inviteGuardian(actorOf(request), request.body.email);
      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.post<{ Body: Static<typeof InvitationTokenRequest> }>(
    "/api/invitations/inspect",
    {
      config: { access: "public" },
      schema: { body: InvitationTokenRequest, response: { 200: InvitationView } },
    },
    async (request) => families.inspectInvitation(request.body.token),
  );

  app.post<{ Body: Static<typeof AcceptInvitationRequest> }>(
    "/api/invitations/accept",
    {
      config: { access: "public" },
      schema: { body: AcceptInvitationRequest, response: { 200: LoginResponse } },
    },
    async (request, reply) => {
      const { token, password, displayName, consent } = request.body;
      const { sessionToken } = await families.acceptInvitation(
        token,
        displayName === undefined ? { password, consent } : { password, displayName, consent },
        clientOf(request),
      );
      await rotate(request);
      setSessionCookie(reply, sessionToken);
      return { status: "authenticated" as const };
    },
  );

  // --- Familles et élèves ----------------------------------------------------------------
  app.get("/api/families", { schema: { response: { 200: FamiliesResponse } } }, async (request) => {
    const view = await families.families(actorOf(request));
    return {
      guardians: view.guardians.map((guardian) => ({ ...guardian })),
      learners: view.learners.map(learnerView),
    };
  });

  app.get("/api/learners", { schema: { response: { 200: LearnersResponse } } }, async (request) => ({
    learners: (await families.myLearners(actorOf(request))).map(learnerView),
  }));

  app.post<{ Body: Static<typeof CreateLearnerRequest> }>(
    "/api/learners",
    { schema: { body: CreateLearnerRequest, response: { 201: CreatedLearnerResponse } } },
    async (request, reply) => {
      const created = await families.createLearner(actorOf(request), request.body);
      return reply.code(201).send(created);
    },
  );

  app.get<{ Params: Static<typeof LearnerParams> }>(
    "/api/learners/:learnerId",
    { schema: { params: LearnerParams, response: { 200: LearnerView } } },
    async (request) =>
      learnerView(await families.learner(actorOf(request), LearnerId(request.params.learnerId))),
  );

  app.post<{ Params: Static<typeof LearnerParams>; Body: Static<typeof NewPasswordRequest> }>(
    "/api/learners/:learnerId/password",
    { schema: { params: LearnerParams, body: NewPasswordRequest } },
    async (request, reply) => {
      await families.resetLearnerPassword(
        actorOf(request),
        LearnerId(request.params.learnerId),
        request.body.password,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof LearnerParams>; Body: Static<typeof InviteRequest> }>(
    "/api/learners/:learnerId/co-guardian-invitations",
    { schema: { params: LearnerParams, body: InviteRequest, response: { 202: AcceptedResponse } } },
    async (request, reply) => {
      await families.inviteCoGuardian(
        actorOf(request),
        LearnerId(request.params.learnerId),
        request.body.email,
      );
      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.post<{ Params: Static<typeof LearnerParams> }>(
    "/api/learners/:learnerId/consent-withdrawal",
    { schema: { params: LearnerParams } },
    async (request, reply) => {
      await families.withdrawConsent(actorOf(request), LearnerId(request.params.learnerId));
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: Static<typeof GuardianshipParams> }>(
    "/api/guardianships/:guardianshipId",
    { schema: { params: GuardianshipParams } },
    async (request, reply) => {
      await families.revokeGuardianship(actorOf(request), GuardianshipId(request.params.guardianshipId));
      return reply.code(204).send();
    },
  );

  app.get("/api/audit", { schema: { response: { 200: AuditResponse } } }, async (request) => ({
    entries: (await audit.latest(actorOf(request))).map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt.toISOString(),
    })),
  }));

  // --- Textes juridiques (publics, affichés sans modification) ----------------------------
  app.get<{ Params: Static<typeof LegalParams> }>(
    "/api/legal/:document",
    {
      config: { access: "public" },
      schema: { params: LegalParams, response: { 200: LegalDocumentResponse } },
    },
    (request, reply) => reply.send(legal.get(request.params.document)),
  );
}
