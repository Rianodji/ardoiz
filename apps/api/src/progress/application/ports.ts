import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { CompetencyId, GroupId, LearnerId, SubjectId, TutorSpaceId } from "../../shared-kernel/ids.js";
import type { Badge } from "../domain/badges.js";
import type { XpReason } from "../domain/experience.js";
import type { Adjustment } from "../domain/mastery.js";

export interface EvidenceRecord {
  readonly competencyId: CompetencyId;
  readonly attemptId: string;
  readonly questionId: string;
  readonly earned: number;
  readonly points: number;
  readonly recordedAt: Date;
}

export interface GradeRecord {
  readonly attemptId: string;
  readonly subjectId: SubjectId;
  readonly title: string;
  readonly grade: number;
  readonly publishedAt: Date;
}

export interface AdjustmentRecord extends Adjustment {
  readonly competencyId: CompetencyId;
  readonly justification: string;
}

/** Projections de progression d'UN espace, dans la transaction courante (celle de l'événement, R10). */
export interface ProgressStore {
  insertEvidence(learnerId: LearnerId, evidence: EvidenceRecord): Promise<void>;
  updateEvidenceEarned(attemptId: string, questionId: string, earned: number, points: number): Promise<void>;
  evidencesOf(learnerId: LearnerId): Promise<EvidenceRecord[]>;
  upsertGrade(learnerId: LearnerId, grade: GradeRecord): Promise<void>;
  updateGrade(attemptId: string, grade: number): Promise<void>;
  gradesOf(learnerId: LearnerId): Promise<GradeRecord[]>;
  /** Faux si ce motif et cette source ont déjà rapporté des points (idempotence). */
  addXp(learnerId: LearnerId, reason: XpReason, source: string, points: number, at: Date): Promise<boolean>;
  xpOf(learnerId: LearnerId): Promise<number>;
  addActivityWeek(learnerId: LearnerId, monday: string): Promise<void>;
  activityWeeksOf(learnerId: LearnerId): Promise<Set<string>>;
  recordConversion(
    learnerId: LearnerId,
    attemptId: string,
    questionId: string,
    succeeded: boolean,
    at: Date,
  ): Promise<void>;
  updateConversion(attemptId: string, questionId: string, succeeded: boolean): Promise<void>;
  conversionsOf(learnerId: LearnerId): Promise<boolean[]>;
  recordSubmission(learnerId: LearnerId, attemptId: string, submittedAt: Date, late: boolean): Promise<void>;
  submissionCount(learnerId: LearnerId): Promise<number>;
  addBadge(learnerId: LearnerId, badge: Badge, at: Date): Promise<boolean>;
  badgesOf(learnerId: LearnerId): Promise<Array<{ badge: Badge; awardedAt: Date }>>;
  insertAdjustment(
    learnerId: LearnerId,
    adjustment: AdjustmentRecord & { id: string; adjustedBy: string },
  ): Promise<void>;
  adjustmentsOf(learnerId: LearnerId): Promise<AdjustmentRecord[]>;
  /** Élèves ayant des données de progression (synthèse du tuteur). */
  learnersWithProgress(): Promise<LearnerId[]>;
  /** Vide toutes les projections de l'espace (reconstruction) ; les ajustements, données sources, restent. */
  clearProjections(): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface ProgressGateway {
  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: ProgressStore) => Promise<T>): Promise<T>;
}

export interface CatalogEntry {
  readonly id: CompetencyId;
  readonly code: string;
  readonly label: string;
  readonly archived: boolean;
  readonly subjectId: SubjectId;
  readonly subjectName: string;
}

/** Ce que la progression demande au programme, par son API publique. */
export interface CurriculumCatalog {
  competencyCatalog(tutorSpaceId: TutorSpaceId): Promise<CatalogEntry[]>;
  groups(tutorSpaceId: TutorSpaceId): Promise<Array<{ id: GroupId; name: string; learnerIds: LearnerId[] }>>;
}

/** Ce que la progression demande à identity : quels identifiants sont des élèves de l'espace. */
export interface LearnerDirectory {
  existingLearners(tutorSpaceId: TutorSpaceId, learnerIds: readonly LearnerId[]): Promise<LearnerId[]>;
}
