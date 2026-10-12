import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type {
  AssessmentId,
  AssignmentId,
  AttemptId,
  CompetencyId,
  GroupId,
  LearnerId,
  QuestionId,
  SubjectId,
  TutorId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import type { Answer } from "../domain/grading.js";
import type { Question } from "../domain/questions.js";

export interface AssessmentRecord {
  readonly id: AssessmentId;
  readonly subjectId: SubjectId;
  readonly title: string;
  readonly questions: readonly Question[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AssignmentRecord {
  readonly id: AssignmentId;
  readonly assessmentId: AssessmentId;
  readonly opensAt: Date;
  readonly dueAt: Date;
  readonly maxAttempts: number;
  readonly lateAllowed: boolean;
  readonly publication: "auto" | "manual";
  readonly learnerIds: readonly LearnerId[];
  readonly createdAt: Date;
  readonly createdBy: TutorId;
}

/** Option de QCM telle que montrée à l'élève pour CETTE tentative : identifiant opaque, ordre mélangé (ADR-0007). */
export interface OptionAlias {
  readonly alias: string;
  readonly optionId: string;
}

export type AttemptStatus = "draft" | "submitted" | "graded" | "published";

export interface AttemptRecord {
  readonly id: AttemptId;
  readonly assignmentId: AssignmentId;
  readonly learnerId: LearnerId;
  readonly number: number;
  readonly status: AttemptStatus;
  readonly optionAliases: Readonly<Record<string, readonly OptionAlias[]>>;
  /** Réponses, avec les vrais identifiants d'options (traduits depuis les alias). */
  readonly answers: Readonly<Record<string, Answer>>;
  readonly answersSha256: string | null;
  readonly startedAt: Date;
  readonly lastSavedAt: Date | null;
  readonly submittedAt: Date | null;
  readonly late: boolean;
  readonly grade: number | null;
  readonly publishedAt: Date | null;
}

export interface QuestionResult {
  readonly questionId: QuestionId;
  readonly earned: number | null;
  readonly gradedBy: "auto" | "tutor" | "pending";
  readonly comment: string | null;
  readonly gradedAt: Date | null;
}

export interface RectificationRecord {
  readonly id: string;
  readonly attemptId: AttemptId;
  readonly questionId: QuestionId;
  readonly previousEarned: number;
  readonly newEarned: number;
  readonly previousGrade: number;
  readonly newGrade: number;
  readonly reason: string;
  readonly rectifiedAt: Date;
  readonly rectifiedBy: TutorId;
}

/** Accès aux données d'évaluation d'UN espace, dans une transaction déclarée à la RLS (R10). */
export interface AssessmentStore {
  assessments(): Promise<AssessmentRecord[]>;
  assessmentById(id: AssessmentId): Promise<AssessmentRecord | null>;
  insertAssessment(assessment: AssessmentRecord): Promise<void>;
  /** Remplace toutes les questions d'une épreuve (seulement tant qu'elle n'est pas attribuée). */
  replaceQuestions(assessmentId: AssessmentId, questions: readonly Question[], at: Date): Promise<void>;
  isAssigned(assessmentId: AssessmentId): Promise<boolean>;

  assignments(): Promise<AssignmentRecord[]>;
  assignmentById(id: AssignmentId): Promise<AssignmentRecord | null>;
  insertAssignment(assignment: AssignmentRecord): Promise<void>;

  attemptsOf(assignmentId: AssignmentId, learnerId: LearnerId): Promise<AttemptRecord[]>;
  attemptsOfLearners(learnerIds: readonly LearnerId[]): Promise<AttemptRecord[]>;
  attemptsToGrade(): Promise<AttemptRecord[]>;
  attemptById(id: AttemptId): Promise<AttemptRecord | null>;
  /** Faux si ce numéro de tentative existe déjà (démarrage concurrent). */
  insertAttempt(attempt: AttemptRecord): Promise<boolean>;
  saveDraft(id: AttemptId, answers: AttemptRecord["answers"], at: Date): Promise<void>;
  /** Fige la copie ; faux si elle n'était plus un brouillon (rendu concurrent). */
  submit(attempt: AttemptRecord): Promise<boolean>;
  updateAttemptStatus(
    id: AttemptId,
    status: AttemptStatus,
    grade: number | null,
    publishedAt: Date | null,
  ): Promise<void>;

  resultsOf(attemptId: AttemptId): Promise<QuestionResult[]>;
  upsertResult(attemptId: AttemptId, result: QuestionResult): Promise<void>;
  /** Autorise, dans CETTE transaction seulement, la modification d'une note publiée (rectification tracée). */
  enableRectification(): Promise<void>;
  insertRectification(rectification: RectificationRecord): Promise<void>;
  rectificationsOf(attemptId: AttemptId): Promise<RectificationRecord[]>;

  audit(entry: AuditEntry): Promise<void>;
  publish(event: IntegrationEvent): Promise<void>;
}

export interface AssessmentGateway {
  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: AssessmentStore) => Promise<T>): Promise<T>;
}

/**
 * Ce que l'évaluation demande au programme, par son API publique (ADR-0001) : les matières et les
 * compétences proposées au choix (non archivées), les élèves d'un groupe.
 */
export interface CurriculumDirectory {
  subjectExists(tutorSpaceId: TutorSpaceId, subjectId: SubjectId): Promise<boolean>;
  activeCompetencyIds(tutorSpaceId: TutorSpaceId): Promise<ReadonlySet<CompetencyId>>;
  learnersOfGroup(tutorSpaceId: TutorSpaceId, groupId: GroupId): Promise<LearnerId[] | null>;
}

/** Ce que l'évaluation demande à identity, par son API publique : quels identifiants sont des élèves de l'espace. */
export interface LearnerDirectory {
  existingLearners(tutorSpaceId: TutorSpaceId, learnerIds: readonly LearnerId[]): Promise<LearnerId[]>;
}

/** Empreinte d'une copie figée (R6). */
export interface ContentHasher {
  sha256(text: string): string;
}
