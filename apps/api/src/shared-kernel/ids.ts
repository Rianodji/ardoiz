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
  AssessmentId: "asm",
  QuestionId: "qst",
  AssignmentId: "asg",
  AttemptId: "att",
  SuggestionId: "sug",
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
export const AuditEntryId = idParser("AuditEntryId");
export const EventId = idParser("EventId");

/** Port de génération d'identifiants : le domaine ne tire jamais d'aléa lui-même. */
export interface IdGenerator {
  next<K extends IdKind>(kind: K): Id<K>;
}
