import { Type, type Static } from "typebox";

/**
 * Contrats HTTP du module identity (règle 5) : chaque corps est un objet fermé
 * (`additionalProperties: false`) aux champs bornés ; les Value Objects du domaine valident ensuite le fond.
 */
const closed = { additionalProperties: false } as const;
const Password = Type.String({ minLength: 1, maxLength: 128 });
const Email = Type.String({ minLength: 3, maxLength: 254 });
const Token = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const Code = Type.String({ minLength: 6, maxLength: 24 });
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const AdultLoginRequest = Type.Object({ email: Email, password: Password }, closed);
export const LearnerLoginRequest = Type.Object(
  {
    spaceCode: Type.String({ minLength: 1, maxLength: 32 }),
    username: Type.String({ minLength: 1, maxLength: 30 }),
    password: Password,
  },
  closed,
);
export const LoginResponse = Type.Object(
  {
    status: Type.Union([
      Type.Literal("authenticated"),
      Type.Literal("mfa-required"),
      Type.Literal("mfa-enrollment-required"),
    ]),
  },
  closed,
);
export type LoginResponse = Static<typeof LoginResponse>;

export const TotpCodeRequest = Type.Object({ code: Code }, closed);
export const ReauthenticateRequest = Type.Object(
  { password: Password, totpCode: Type.Optional(Code) },
  closed,
);
export const TotpEnrollmentResponse = Type.Object(
  { otpauthUri: Type.String({ maxLength: 500 }), secret: Type.String({ maxLength: 64 }) },
  closed,
);
export type TotpEnrollmentResponse = Static<typeof TotpEnrollmentResponse>;
export const RecoveryCodesResponse = Type.Object(
  { recoveryCodes: Type.Array(Type.String(), { maxItems: 20 }) },
  closed,
);
export type RecoveryCodesResponse = Static<typeof RecoveryCodesResponse>;

export const MeResponse = Type.Object(
  {
    kind: Type.Union([Type.Literal("tutor"), Type.Literal("guardian"), Type.Literal("learner")]),
    id: Type.String(),
    name: Type.String(),
    mfaEnrolled: Type.Boolean(),
  },
  closed,
);
export type MeResponse = Static<typeof MeResponse>;

export const SessionView = Type.Object(
  {
    id: Type.String(),
    current: Type.Boolean(),
    createdAt: Type.String({ format: "date-time" }),
    lastSeenAt: Type.String({ format: "date-time" }),
    userAgent: Type.Union([Type.String(), Type.Null()]),
  },
  closed,
);
export const SessionsResponse = Type.Object({ sessions: Type.Array(SessionView) }, closed);
export type SessionsResponse = Static<typeof SessionsResponse>;

export const ConsentDeclaration = Type.Object(
  { accepted: Type.Boolean(), version: Type.String({ maxLength: 50 }), sha256: Sha256 },
  closed,
);

export const InviteRequest = Type.Object({ email: Email }, closed);
export const InvitationTokenRequest = Type.Object({ token: Token }, closed);
export const InvitationView = Type.Object(
  {
    kind: Type.Union([Type.Literal("guardian"), Type.Literal("co_guardian")]),
    email: Type.String(),
    learnerFirstName: Type.Union([Type.String(), Type.Null()]),
    accountExists: Type.Boolean(),
    consent: Type.Object({ version: Type.String(), sha256: Sha256 }, closed),
  },
  closed,
);
export type InvitationView = Static<typeof InvitationView>;
export const AcceptInvitationRequest = Type.Object(
  {
    token: Token,
    password: Password,
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    consent: ConsentDeclaration,
  },
  closed,
);

export const CreateLearnerRequest = Type.Object(
  {
    firstName: Type.String({ minLength: 1, maxLength: 50 }),
    username: Type.String({ minLength: 3, maxLength: 30 }),
    schoolLevel: Type.String({ maxLength: 3 }),
    password: Password,
    consent: ConsentDeclaration,
  },
  closed,
);
export const CreatedLearnerResponse = Type.Object({ learnerId: Type.String() }, closed);
export const NewPasswordRequest = Type.Object({ password: Password }, closed);

export const LearnerView = Type.Object(
  {
    id: Type.String(),
    firstName: Type.String(),
    username: Type.String(),
    schoolLevel: Type.String(),
    status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
    guardians: Type.Array(
      Type.Object(
        { guardianshipId: Type.String(), guardianId: Type.String(), displayName: Type.String() },
        closed,
      ),
    ),
  },
  closed,
);
export type LearnerView = Static<typeof LearnerView>;
export const LearnersResponse = Type.Object({ learners: Type.Array(LearnerView) }, closed);
export type LearnersResponse = Static<typeof LearnersResponse>;
export const FamiliesResponse = Type.Object(
  {
    guardians: Type.Array(
      Type.Object({ id: Type.String(), displayName: Type.String(), email: Type.String() }, closed),
    ),
    learners: Type.Array(LearnerView),
  },
  closed,
);
export type FamiliesResponse = Static<typeof FamiliesResponse>;

export const PasswordResetRequest = Type.Object({ email: Email }, closed);
export const PasswordResetCompletion = Type.Object({ token: Token, password: Password }, closed);
export const AcceptedResponse = Type.Object({ status: Type.Literal("accepted") }, closed);

export const LEGAL_DOCUMENTS = [
  "mentions-legales",
  "confidentialite",
  "confidentialite-eleve",
  "consentement",
] as const;
export const LegalDocumentResponse = Type.Object(
  {
    document: Type.String(),
    markdown: Type.String(),
    version: Type.Union([Type.String(), Type.Null()]),
    sha256: Sha256,
  },
  closed,
);
export type LegalDocumentResponse = Static<typeof LegalDocumentResponse>;

export const AuditEntryView = Type.Object(
  {
    occurredAt: Type.String({ format: "date-time" }),
    action: Type.String(),
    actorKind: Type.String(),
    actorId: Type.Union([Type.String(), Type.Null()]),
    targetId: Type.Union([Type.String(), Type.Null()]),
    outcome: Type.String(),
    reasonCode: Type.Union([Type.String(), Type.Null()]),
  },
  closed,
);
export const AuditResponse = Type.Object({ entries: Type.Array(AuditEntryView) }, closed);
export type AuditResponse = Static<typeof AuditResponse>;
