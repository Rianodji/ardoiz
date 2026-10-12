import type { LessonContent } from "@ardoiz/content-schema";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type {
  CompetencyDomainId,
  CompetencyId,
  GroupId,
  LearnerId,
  LessonId,
  MediaId,
  ModuleId,
  SubjectId,
  TutorId,
  TutorSpaceId,
  UnlockId,
} from "../../shared-kernel/ids.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import type { UnlockAudience, UnlockTarget } from "../domain/access.js";

export interface SubjectRecord {
  readonly id: SubjectId;
  readonly name: string;
  readonly position: number;
}
export interface DomainRecord {
  readonly id: CompetencyDomainId;
  readonly subjectId: SubjectId;
  readonly prefix: string;
  readonly label: string;
  readonly position: number;
}
export interface CompetencyRecord {
  readonly id: CompetencyId;
  readonly domainId: CompetencyDomainId;
  readonly code: string;
  readonly label: string;
  readonly position: number;
  readonly archivedAt: Date | null;
}
export interface ModuleRecord {
  readonly id: ModuleId;
  readonly subjectId: SubjectId;
  readonly title: string;
  readonly position: number;
}
export interface LessonRecord {
  readonly id: LessonId;
  readonly moduleId: ModuleId;
  readonly title: string;
  readonly status: "draft" | "published";
  readonly content: LessonContent | null;
  readonly position: number;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
}
export interface MediaRecord {
  readonly id: MediaId;
  readonly lessonId: LessonId;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly sha256: string;
  readonly createdAt: Date;
}
export interface GroupRecord {
  readonly id: GroupId;
  readonly name: string;
  readonly learnerIds: readonly LearnerId[];
}
export interface UnlockRecord {
  readonly id: UnlockId;
  readonly target: UnlockTarget;
  readonly audience: UnlockAudience;
  readonly unlockedAt: Date;
  readonly unlockedBy: TutorId;
  readonly relockedAt: Date | null;
}
export interface CompletionRecord {
  readonly learnerId: LearnerId;
  readonly lessonId: LessonId;
  readonly completedAt: Date;
}

/** Accès aux données du programme d'UN espace, dans une transaction déclarée à la RLS (R10). */
export interface CurriculumStore {
  subjects(): Promise<SubjectRecord[]>;
  domains(): Promise<DomainRecord[]>;
  competencies(): Promise<CompetencyRecord[]>;
  insertSubject(subject: SubjectRecord, createdAt: Date): Promise<void>;
  insertDomain(domain: DomainRecord): Promise<void>;
  insertCompetency(competency: CompetencyRecord, createdAt: Date): Promise<void>;
  updateCompetency(competency: CompetencyRecord): Promise<void>;

  modules(): Promise<ModuleRecord[]>;
  insertModule(module: ModuleRecord, createdAt: Date): Promise<void>;
  updateModule(module: ModuleRecord): Promise<void>;

  lessons(): Promise<LessonRecord[]>;
  lessonById(id: LessonId): Promise<LessonRecord | null>;
  insertLesson(lesson: LessonRecord): Promise<void>;
  updateLesson(lesson: LessonRecord): Promise<void>;

  insertMedia(media: MediaRecord): Promise<void>;
  mediaById(id: MediaId): Promise<MediaRecord | null>;
  mediaOfLesson(lessonId: LessonId): Promise<MediaRecord[]>;

  groups(): Promise<GroupRecord[]>;
  insertGroup(group: GroupRecord, createdAt: Date): Promise<void>;
  /** Remplace les membres d'un groupe ; un élève d'un autre espace est refusé par la base (R10). */
  setGroupMembers(groupId: GroupId, learnerIds: readonly LearnerId[]): Promise<void>;

  activeUnlocks(): Promise<UnlockRecord[]>;
  unlockById(id: UnlockId): Promise<UnlockRecord | null>;
  insertUnlock(unlock: UnlockRecord): Promise<void>;
  relock(id: UnlockId, at: Date): Promise<void>;

  completionsOf(learnerIds: readonly LearnerId[]): Promise<CompletionRecord[]>;
  /** Vrai si le cours n'était pas encore terminé par cet élève (idempotent). */
  insertCompletion(completion: CompletionRecord): Promise<boolean>;

  audit(entry: AuditEntry): Promise<void>;
  /** Événement d'intégration écrit dans l'outbox, dans la même transaction (outbox → progress, L6). */
  publish(event: IntegrationEvent): Promise<void>;
}

export interface CurriculumGateway {
  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: CurriculumStore) => Promise<T>): Promise<T>;
}

/** Stockage des fichiers importés (volume local au J1) : nom généré, jamais celui fourni (R14). */
export interface FileStorage {
  save(tutorSpaceId: TutorSpaceId, mediaId: MediaId, bytes: Buffer): Promise<void>;
  read(tutorSpaceId: TutorSpaceId, mediaId: MediaId): Promise<Buffer>;
}

export interface IngestedImage {
  readonly webp: Buffer;
  readonly width: number;
  readonly height: number;
  /** Empreinte SHA-256 du fichier réencodé. */
  readonly sha256: string;
}

/** Import d'une image (R14) : type reconnu par ses octets, taille et dimensions bornées, réencodage sans métadonnées. */
export interface ImageIngestion {
  ingest(bytes: Buffer): Promise<IngestedImage>;
}
