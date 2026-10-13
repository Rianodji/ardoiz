import { InvalidIdentifierError } from "./DomainError.js";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * Préfixe de chaque type d'identifiant (noms du glossaire). Un identifiant porte son type :
 * un `lrn_…` passé là où l'on attend un `les_…` est rejeté à l'analyse.
 */
export const ID_PREFIXES = {
  TutorSpaceId: "tsp",
  TutorId: "tut",
  GuardianId: "gdn",
  LearnerId: "lrn",
  GuardianshipId: "gsh",
  ParentalConsentId: "pcn",
  InvitationId: "inv",
  GroupId: "grp",
  SubjectId: "sbj",
  CompetencyId: "cmp",
  ModuleId: "mod",
  LessonId: "les",
  UnlockId: "unl",
  TutoringSessionId: "tss",
  SessionOccurrenceId: "soc",
  AssessmentId: "asm",
  QuestionId: "qst",
  AssignmentId: "asg",
  AttemptId: "att",
  SuggestionId: "sug",
  AuthSessionId: "ses",
  RecoveryCodeId: "rcv",
  PasswordResetId: "pwr",
  CompetencyDomainId: "dom",
  MediaId: "med",
  NotebookMediaId: "nmd",
  RectificationId: "rec",
  AuditEntryId: "aud",
  EventId: "evt",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type Id<K extends IdKind> = Brand<string, K>;

export type TutorSpaceId = Id<"TutorSpaceId">;
export type TutorId = Id<"TutorId">;
export type GuardianId = Id<"GuardianId">;
export type LearnerId = Id<"LearnerId">;
export type LessonId = Id<"LessonId">;
export type GuardianshipId = Id<"GuardianshipId">;
export type ParentalConsentId = Id<"ParentalConsentId">;
export type InvitationId = Id<"InvitationId">;
export type AuthSessionId = Id<"AuthSessionId">;
export type SubjectId = Id<"SubjectId">;
export type CompetencyDomainId = Id<"CompetencyDomainId">;
export type CompetencyId = Id<"CompetencyId">;
export type ModuleId = Id<"ModuleId">;
export type GroupId = Id<"GroupId">;
export type UnlockId = Id<"UnlockId">;
export type MediaId = Id<"MediaId">;
export type TutoringSessionId = Id<"TutoringSessionId">;
export type SessionOccurrenceId = Id<"SessionOccurrenceId">;
export type NotebookMediaId = Id<"NotebookMediaId">;
export type AssessmentId = Id<"AssessmentId">;
export type QuestionId = Id<"QuestionId">;
export type AssignmentId = Id<"AssignmentId">;
export type AttemptId = Id<"AttemptId">;
export type AuditEntryId = Id<"AuditEntryId">;
export type EventId = Id<"EventId">;

/**
 * UUID version 7 (RFC 9562). Il n'est pas devinable, mais ce n'est qu'une défense en profondeur :
 * l'accès est toujours décidé par une politique (M2).
 */
const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/** Analyseur d'identifiant : toute valeur venue de l'extérieur (URL, corps, base) passe par lui. */
export function idParser<K extends IdKind>(kind: K): (raw: unknown) => Id<K> {
  const prefix = ID_PREFIXES[kind];
  const pattern = new RegExp(`^${prefix}_${UUID_V7}$`);
  return (raw: unknown): Id<K> => {
    if (typeof raw !== "string" || !pattern.test(raw)) throw new InvalidIdentifierError(prefix);
    return raw as Id<K>;
  };
}

export const TutorSpaceId = idParser("TutorSpaceId");
export const TutorId = idParser("TutorId");
export const GuardianId = idParser("GuardianId");
export const LearnerId = idParser("LearnerId");
export const LessonId = idParser("LessonId");
export const GuardianshipId = idParser("GuardianshipId");
export const ParentalConsentId = idParser("ParentalConsentId");
export const InvitationId = idParser("InvitationId");
export const AuthSessionId = idParser("AuthSessionId");
export const SubjectId = idParser("SubjectId");
export const CompetencyDomainId = idParser("CompetencyDomainId");
export const CompetencyId = idParser("CompetencyId");
export const ModuleId = idParser("ModuleId");
export const GroupId = idParser("GroupId");
export const UnlockId = idParser("UnlockId");
export const MediaId = idParser("MediaId");
export const TutoringSessionId = idParser("TutoringSessionId");
export const SessionOccurrenceId = idParser("SessionOccurrenceId");
export const NotebookMediaId = idParser("NotebookMediaId");
export const AssessmentId = idParser("AssessmentId");
export const QuestionId = idParser("QuestionId");
export const AssignmentId = idParser("AssignmentId");
export const AttemptId = idParser("AttemptId");
export const AuditEntryId = idParser("AuditEntryId");
export const EventId = idParser("EventId");

/** Port de génération d'identifiants : le domaine ne tire jamais d'aléa lui-même. */
export interface IdGenerator {
  next<K extends IdKind>(kind: K): Id<K>;
}
