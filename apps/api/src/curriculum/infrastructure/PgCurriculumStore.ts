import { validateLessonContent, type LessonContent } from "@ardoiz/content-schema";
import type { Pool, PoolClient } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { appendToOutbox } from "../../platform/messaging/PgOutbox.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type {
  GroupId,
  LearnerId,
  LessonId,
  MediaId,
  TutorSpaceId,
  UnlockId,
} from "../../shared-kernel/ids.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import type { UnlockAudience, UnlockTarget } from "../domain/access.js";
import { CurriculumConflictError } from "../domain/errors.js";
import type {
  CompetencyRecord,
  CompletionRecord,
  CurriculumGateway,
  CurriculumStore,
  DomainRecord,
  GroupRecord,
  LessonRecord,
  MediaRecord,
  ModuleRecord,
  SubjectRecord,
  UnlockRecord,
} from "../application/ports.js";

interface LessonRow {
  id: string;
  module_id: string;
  title: string;
  status: "draft" | "published";
  content: unknown;
  position: number;
  updated_at: Date;
  published_at: Date | null;
}

interface UnlockRow {
  id: string;
  module_id: string | null;
  lesson_id: string | null;
  learner_id: string | null;
  group_id: string | null;
  unlocked_at: Date;
  unlocked_by: string;
  relocked_at: Date | null;
}

interface MediaRow {
  id: string;
  lesson_id: string;
  width: number;
  height: number;
  byte_size: number;
  sha256: string;
  created_at: Date;
}

/**
 * Un contenu relu en base repasse par le validateur : une donnée altérée hors de l'application
 * (restauration, intervention manuelle) n'est jamais servie telle quelle à un enfant (R4).
 */
function storedContent(raw: unknown): LessonContent | null {
  if (raw === null) return null;
  const validation = validateLessonContent(raw);
  if (!validation.ok) throw new Error("Contenu de cours invalide en base.");
  return validation.value;
}

function toLesson(row: LessonRow): LessonRecord {
  return {
    id: fromUuid("LessonId", row.id),
    moduleId: fromUuid("ModuleId", row.module_id),
    title: row.title,
    status: row.status,
    content: storedContent(row.content),
    position: row.position,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function toUnlock(row: UnlockRow): UnlockRecord {
  const target: UnlockTarget =
    row.module_id !== null
      ? { kind: "module", id: fromUuid("ModuleId", row.module_id) }
      : { kind: "lesson", id: fromUuid("LessonId", row.lesson_id ?? "") };
  const audience: UnlockAudience =
    row.learner_id !== null
      ? { kind: "learner", id: fromUuid("LearnerId", row.learner_id) }
      : { kind: "group", id: fromUuid("GroupId", row.group_id ?? "") };
  return {
    id: fromUuid("UnlockId", row.id),
    target,
    audience,
    unlockedAt: row.unlocked_at,
    unlockedBy: fromUuid("TutorId", row.unlocked_by),
    relockedAt: row.relocked_at,
  };
}

function toMedia(row: MediaRow): MediaRecord {
  return {
    id: fromUuid("MediaId", row.id),
    lessonId: fromUuid("LessonId", row.lesson_id),
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

/** Clé étrangère violée (élève ou groupe absent de l'espace) : la ressource est introuvable, rien de plus (R2, R10). */
async function translating<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "23503") throw new NotFoundError();
      if (error.code === "23505") throw new CurriculumConflictError("curriculum.name-taken");
    }
    throw error;
  }
}

const LESSON_COLUMNS = "id, module_id, title, status, content, position, updated_at, published_at";
const UNLOCK_COLUMNS =
  "id, module_id, lesson_id, learner_id, group_id, unlocked_at, unlocked_by, relocked_at";
const MEDIA_COLUMNS = "id, lesson_id, width, height, byte_size, sha256, created_at";

/** Adaptateur PostgreSQL du port `CurriculumStore`, lié à la connexion d'une transaction d'espace. */
export class PgCurriculumStore implements CurriculumStore {
  constructor(
    private readonly client: PoolClient,
    private readonly tutorSpaceId: TutorSpaceId,
  ) {}

  get #space(): string {
    return toUuid(this.tutorSpaceId);
  }

  async subjects(): Promise<SubjectRecord[]> {
    const { rows } = await this.client.query<{ id: string; name: string; position: number }>(
      "SELECT id, name, position FROM curriculum.subjects ORDER BY position, name",
    );
    return rows.map((row) => ({ id: fromUuid("SubjectId", row.id), name: row.name, position: row.position }));
  }

  async domains(): Promise<DomainRecord[]> {
    const { rows } = await this.client.query<{
      id: string;
      subject_id: string;
      prefix: string;
      label: string;
      position: number;
    }>(
      "SELECT id, subject_id, prefix, label, position FROM curriculum.competency_domains ORDER BY position, prefix",
    );
    return rows.map((row) => ({
      id: fromUuid("CompetencyDomainId", row.id),
      subjectId: fromUuid("SubjectId", row.subject_id),
      prefix: row.prefix,
      label: row.label,
      position: row.position,
    }));
  }

  async competencies(): Promise<CompetencyRecord[]> {
    const { rows } = await this.client.query<{
      id: string;
      domain_id: string;
      code: string;
      label: string;
      position: number;
      archived_at: Date | null;
    }>(
      "SELECT id, domain_id, code, label, position, archived_at FROM curriculum.competencies ORDER BY position, code",
    );
    return rows.map((row) => ({
      id: fromUuid("CompetencyId", row.id),
      domainId: fromUuid("CompetencyDomainId", row.domain_id),
      code: row.code,
      label: row.label,
      position: row.position,
      archivedAt: row.archived_at,
    }));
  }

  async insertSubject(subject: SubjectRecord, createdAt: Date): Promise<void> {
    await translating(() =>
      this.client.query(
        "INSERT INTO curriculum.subjects (id, tutor_space_id, name, position, created_at) VALUES ($1, $2, $3, $4, $5)",
        [toUuid(subject.id), this.#space, subject.name, subject.position, createdAt],
      ),
    );
  }

  async insertDomain(domain: DomainRecord): Promise<void> {
    await this.client.query(
      "INSERT INTO curriculum.competency_domains (id, tutor_space_id, subject_id, prefix, label, position) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        toUuid(domain.id),
        this.#space,
        toUuid(domain.subjectId),
        domain.prefix,
        domain.label,
        domain.position,
      ],
    );
  }

  async insertCompetency(competency: CompetencyRecord, createdAt: Date): Promise<void> {
    await this.client.query(
      `INSERT INTO curriculum.competencies (id, tutor_space_id, domain_id, code, label, position, archived_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        toUuid(competency.id),
        this.#space,
        toUuid(competency.domainId),
        competency.code,
        competency.label,
        competency.position,
        competency.archivedAt,
        createdAt,
      ],
    );
  }

  async updateCompetency(competency: CompetencyRecord): Promise<void> {
    // Le code n'est pas modifiable : il ne figure pas dans la requête, et la base le refuserait (GRANT par colonne).
    await this.client.query(
      "UPDATE curriculum.competencies SET label = $2, position = $3, archived_at = $4 WHERE id = $1",
      [toUuid(competency.id), competency.label, competency.position, competency.archivedAt],
    );
  }

  async modules(): Promise<ModuleRecord[]> {
    const { rows } = await this.client.query<{
      id: string;
      subject_id: string;
      title: string;
      position: number;
    }>("SELECT id, subject_id, title, position FROM curriculum.modules ORDER BY position, created_at");
    return rows.map((row) => ({
      id: fromUuid("ModuleId", row.id),
      subjectId: fromUuid("SubjectId", row.subject_id),
      title: row.title,
      position: row.position,
    }));
  }

  async insertModule(module: ModuleRecord, createdAt: Date): Promise<void> {
    await this.client.query(
      "INSERT INTO curriculum.modules (id, tutor_space_id, subject_id, title, position, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [toUuid(module.id), this.#space, toUuid(module.subjectId), module.title, module.position, createdAt],
    );
  }

  async updateModule(module: ModuleRecord): Promise<void> {
    await this.client.query("UPDATE curriculum.modules SET title = $2, position = $3 WHERE id = $1", [
      toUuid(module.id),
      module.title,
      module.position,
    ]);
  }

  async lessons(): Promise<LessonRecord[]> {
    const { rows } = await this.client.query<LessonRow>(
      `SELECT ${LESSON_COLUMNS} FROM curriculum.lessons ORDER BY position, updated_at`,
    );
    return rows.map(toLesson);
  }

  async lessonById(id: LessonId): Promise<LessonRecord | null> {
    const { rows } = await this.client.query<LessonRow>(
      `SELECT ${LESSON_COLUMNS} FROM curriculum.lessons WHERE id = $1`,
      [toUuid(id)],
    );
    return rows[0] === undefined ? null : toLesson(rows[0]);
  }

  async insertLesson(lesson: LessonRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO curriculum.lessons (id, tutor_space_id, module_id, title, status, content, content_schema_version, position, updated_at, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        toUuid(lesson.id),
        this.#space,
        toUuid(lesson.moduleId),
        lesson.title,
        lesson.status,
        lesson.content === null ? null : JSON.stringify(lesson.content),
        lesson.content === null ? null : 1,
        lesson.position,
        lesson.updatedAt,
        lesson.publishedAt,
      ],
    );
  }

  async updateLesson(lesson: LessonRecord): Promise<void> {
    await this.client.query(
      `UPDATE curriculum.lessons
          SET title = $2, status = $3, content = $4, content_schema_version = $5, position = $6, updated_at = $7, published_at = $8
        WHERE id = $1`,
      [
        toUuid(lesson.id),
        lesson.title,
        lesson.status,
        lesson.content === null ? null : JSON.stringify(lesson.content),
        lesson.content === null ? null : 1,
        lesson.position,
        lesson.updatedAt,
        lesson.publishedAt,
      ],
    );
  }

  async insertMedia(media: MediaRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO curriculum.media (id, tutor_space_id, lesson_id, content_type, width, height, byte_size, sha256, created_at)
       VALUES ($1, $2, $3, 'image/webp', $4, $5, $6, $7, $8)`,
      [
        toUuid(media.id),
        this.#space,
        toUuid(media.lessonId),
        media.width,
        media.height,
        media.byteSize,
        media.sha256,
        media.createdAt,
      ],
    );
  }

  async mediaById(id: MediaId): Promise<MediaRecord | null> {
    const { rows } = await this.client.query<MediaRow>(
      `SELECT ${MEDIA_COLUMNS} FROM curriculum.media WHERE id = $1`,
      [toUuid(id)],
    );
    return rows[0] === undefined ? null : toMedia(rows[0]);
  }

  async mediaOfLesson(lessonId: LessonId): Promise<MediaRecord[]> {
    const { rows } = await this.client.query<MediaRow>(
      `SELECT ${MEDIA_COLUMNS} FROM curriculum.media WHERE lesson_id = $1`,
      [toUuid(lessonId)],
    );
    return rows.map(toMedia);
  }

  async groups(): Promise<GroupRecord[]> {
    const { rows } = await this.client.query<{ id: string; name: string; learner_ids: string[] | null }>(
      `SELECT g.id, g.name, array_agg(m.learner_id ORDER BY m.learner_id) FILTER (WHERE m.learner_id IS NOT NULL) AS learner_ids
         FROM curriculum.groups g LEFT JOIN curriculum.group_members m ON m.group_id = g.id
        GROUP BY g.id, g.name ORDER BY g.name`,
    );
    return rows.map((row) => ({
      id: fromUuid("GroupId", row.id),
      name: row.name,
      learnerIds: (row.learner_ids ?? []).map((id) => fromUuid("LearnerId", id)),
    }));
  }

  async insertGroup(group: GroupRecord, createdAt: Date): Promise<void> {
    await translating(() =>
      this.client.query(
        "INSERT INTO curriculum.groups (id, tutor_space_id, name, created_at) VALUES ($1, $2, $3, $4)",
        [toUuid(group.id), this.#space, group.name, createdAt],
      ),
    );
  }

  async setGroupMembers(groupId: GroupId, learnerIds: readonly LearnerId[]): Promise<void> {
    await this.client.query("DELETE FROM curriculum.group_members WHERE group_id = $1", [toUuid(groupId)]);
    for (const learnerId of learnerIds) {
      await translating(() =>
        this.client.query(
          "INSERT INTO curriculum.group_members (tutor_space_id, group_id, learner_id) VALUES ($1, $2, $3)",
          [this.#space, toUuid(groupId), toUuid(learnerId)],
        ),
      );
    }
  }

  async activeUnlocks(): Promise<UnlockRecord[]> {
    const { rows } = await this.client.query<UnlockRow>(
      `SELECT ${UNLOCK_COLUMNS} FROM curriculum.unlocks WHERE relocked_at IS NULL ORDER BY unlocked_at`,
    );
    return rows.map(toUnlock);
  }

  async unlockById(id: UnlockId): Promise<UnlockRecord | null> {
    const { rows } = await this.client.query<UnlockRow>(
      `SELECT ${UNLOCK_COLUMNS} FROM curriculum.unlocks WHERE id = $1`,
      [toUuid(id)],
    );
    return rows[0] === undefined ? null : toUnlock(rows[0]);
  }

  async insertUnlock(unlock: UnlockRecord): Promise<void> {
    await translating(() =>
      this.client.query(
        `INSERT INTO curriculum.unlocks (id, tutor_space_id, module_id, lesson_id, learner_id, group_id, unlocked_at, unlocked_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          toUuid(unlock.id),
          this.#space,
          unlock.target.kind === "module" ? toUuid(unlock.target.id) : null,
          unlock.target.kind === "lesson" ? toUuid(unlock.target.id) : null,
          unlock.audience.kind === "learner" ? toUuid(unlock.audience.id) : null,
          unlock.audience.kind === "group" ? toUuid(unlock.audience.id) : null,
          unlock.unlockedAt,
          toUuid(unlock.unlockedBy),
        ],
      ),
    );
  }

  async relock(id: UnlockId, at: Date): Promise<void> {
    await this.client.query(
      "UPDATE curriculum.unlocks SET relocked_at = $2 WHERE id = $1 AND relocked_at IS NULL",
      [toUuid(id), at],
    );
  }

  async completionsOf(learnerIds: readonly LearnerId[]): Promise<CompletionRecord[]> {
    const { rows } = await this.client.query<{ learner_id: string; lesson_id: string; completed_at: Date }>(
      "SELECT learner_id, lesson_id, completed_at FROM curriculum.lesson_completions WHERE learner_id = ANY($1::uuid[])",
      [learnerIds.map((id) => toUuid(id))],
    );
    return rows.map((row) => ({
      learnerId: fromUuid("LearnerId", row.learner_id),
      lessonId: fromUuid("LessonId", row.lesson_id),
      completedAt: row.completed_at,
    }));
  }

  async insertCompletion(completion: CompletionRecord): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO curriculum.lesson_completions (tutor_space_id, learner_id, lesson_id, completed_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [this.#space, toUuid(completion.learnerId), toUuid(completion.lessonId), completion.completedAt],
    );
    return result.rowCount === 1;
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        toUuid(entry.id),
        toUuid(entry.tutorSpaceId),
        entry.occurredAt,
        entry.action,
        entry.actor.kind,
        entry.actor.kind === "system" ? null : entry.actor.id,
        entry.targetId ?? null,
        entry.outcome,
        entry.reasonCode ?? null,
      ],
    );
  }

  async publish(event: IntegrationEvent): Promise<void> {
    await appendToOutbox(this.client, event);
  }
}

export class PgCurriculumGateway implements CurriculumGateway {
  constructor(private readonly pool: Pool) {}

  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: CurriculumStore) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, tutorSpaceId, (client) =>
      work(new PgCurriculumStore(client, tutorSpaceId)),
    );
  }
}
