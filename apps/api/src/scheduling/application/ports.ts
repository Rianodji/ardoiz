import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type {
  GroupId,
  LearnerId,
  SessionOccurrenceId,
  TutorId,
  TutoringSessionId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import type { Recurrence } from "../domain/schedule.js";

export interface SessionRecord {
  readonly id: TutoringSessionId;
  readonly title: string;
  readonly meetingLink: string;
  readonly recurrence: Recurrence;
  readonly learnerIds: readonly LearnerId[];
  readonly createdAt: Date;
  readonly createdBy: TutorId;
  readonly linkChangedAt: Date;
}

export interface OccurrenceRecord {
  readonly id: SessionOccurrenceId;
  readonly sessionId: TutoringSessionId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly moved: boolean;
  readonly cancelledAt: Date | null;
}

/** Accès aux séances d'UN espace, dans une transaction déclarée à la RLS (R10). */
export interface SchedulingStore {
  sessions(): Promise<SessionRecord[]>;
  sessionById(id: TutoringSessionId): Promise<SessionRecord | null>;
  insertSession(session: SessionRecord, occurrences: readonly OccurrenceRecord[]): Promise<void>;
  changeLink(id: TutoringSessionId, link: string, at: Date): Promise<void>;
  /** Occurrences qui chevauchent [from, to[, triées par début. */
  occurrencesBetween(from: Date, to: Date): Promise<OccurrenceRecord[]>;
  occurrencesOf(sessionId: TutoringSessionId): Promise<OccurrenceRecord[]>;
  occurrenceById(id: SessionOccurrenceId): Promise<OccurrenceRecord | null>;
  moveOccurrence(id: SessionOccurrenceId, startsAt: Date, endsAt: Date): Promise<void>;
  cancelOccurrence(id: SessionOccurrenceId, at: Date): Promise<void>;
  /** Faux si l'élève avait déjà rejoint cette occurrence (présence comptée une fois). */
  recordAttendance(occurrenceId: SessionOccurrenceId, learnerId: LearnerId, at: Date): Promise<boolean>;
  audit(entry: AuditEntry): Promise<void>;
  publish(event: IntegrationEvent): Promise<void>;
}

export interface SchedulingGateway {
  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: SchedulingStore) => Promise<T>): Promise<T>;
}

/** Ce que la planification demande à identity : quels identifiants sont des élèves de l'espace. */
export interface LearnerDirectory {
  existingLearners(tutorSpaceId: TutorSpaceId, learnerIds: readonly LearnerId[]): Promise<LearnerId[]>;
}

/** Ce que la planification demande au programme : les élèves d'un groupe. */
export interface GroupDirectory {
  learnersOfGroup(tutorSpaceId: TutorSpaceId, groupId: GroupId): Promise<LearnerId[] | null>;
}
