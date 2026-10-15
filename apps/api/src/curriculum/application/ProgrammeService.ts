import { mediaIdsOf, validateLessonContent } from "@ardoiz/content-schema";
import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { AuditAction } from "../../shared-kernel/auditActions.js";
import type { LessonId, ModuleId, SubjectId } from "../../shared-kernel/ids.js";
import { EmptyLessonError, InvalidLessonContentError } from "../domain/errors.js";
import { Position, Title } from "../domain/values.js";
import { canAuthor } from "./policies.js";
import type { LessonRecord, ModuleRecord, SubjectRecord } from "./ports.js";
import { auditOf, authorize, type CurriculumDependencies } from "./support.js";

export interface ProgrammeTree {
  readonly subjects: readonly SubjectRecord[];
  readonly modules: readonly ModuleRecord[];
  readonly lessons: ReadonlyArray<Omit<LessonRecord, "content">>;
}

/**
 * Programme, côté tuteur : modules, cours (brouillon / publié), ordre, contenu riche.
 * Le contenu n'est accepté que s'il respecte le schéma fermé (R4) et ne cite que des médias de ce cours (R3).
 */
export class ProgrammeService {
  constructor(private readonly deps: CurriculumDependencies) {}

  async tree(actor: Actor): Promise<ProgrammeTree> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.read-programme");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => ({
      subjects: await store.subjects(),
      modules: await store.modules(),
      // Le contenu ne quitte pas le serveur dans la vue d'ensemble : il est lu cours par cours.
      lessons: (await store.lessons()).map((lesson) => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        status: lesson.status,
        position: lesson.position,
        updatedAt: lesson.updatedAt,
        publishedAt: lesson.publishedAt,
      })),
    }));
  }

  async createModule(actor: Actor, subjectId: SubjectId, rawTitle: unknown): Promise<ModuleRecord> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.create-module");
    const title = Title(rawTitle);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if (!(await store.subjects()).some((subject) => subject.id === subjectId)) throw new NotFoundError();
      const module: ModuleRecord = {
        id: this.deps.ids.next("ModuleId"),
        subjectId,
        title,
        position: (await store.modules()).filter((candidate) => candidate.subjectId === subjectId).length,
      };
      await store.insertModule(module, this.deps.clock.now());
      return module;
    });
  }

  async updateModule(
    actor: Actor,
    id: ModuleId,
    changes: { title?: unknown; position?: unknown },
  ): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.update-module", id);
    const title = changes.title === undefined ? undefined : Title(changes.title);
    const position = changes.position === undefined ? undefined : Position(changes.position);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const current = (await store.modules()).find((candidate) => candidate.id === id);
      if (current === undefined) throw new NotFoundError();
      await store.updateModule({
        ...current,
        ...(title === undefined ? {} : { title }),
        ...(position === undefined ? {} : { position }),
      });
    });
  }

  async createLesson(actor: Actor, moduleId: ModuleId, rawTitle: unknown): Promise<LessonRecord> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.create-lesson");
    const title = Title(rawTitle);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if (!(await store.modules()).some((module) => module.id === moduleId)) throw new NotFoundError();
      const lesson: LessonRecord = {
        id: this.deps.ids.next("LessonId"),
        moduleId,
        title,
        status: "draft",
        content: null,
        position: (await store.lessons()).filter((candidate) => candidate.moduleId === moduleId).length,
        updatedAt: this.deps.clock.now(),
        publishedAt: null,
      };
      await store.insertLesson(lesson);
      return lesson;
    });
  }

  /** Le cours complet, brouillon compris : pour l'éditeur du tuteur. */
  async lessonForAuthor(actor: Actor, id: LessonId): Promise<LessonRecord> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.edit-lesson", id);
    const lesson = await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.lessonById(id));
    if (lesson === null) throw new NotFoundError();
    return lesson;
  }

  async updateLesson(
    actor: Actor,
    id: LessonId,
    changes: { title?: unknown; position?: unknown },
  ): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.edit-lesson", id);
    const title = changes.title === undefined ? undefined : Title(changes.title);
    const position = changes.position === undefined ? undefined : Position(changes.position);
    await this.#change(actor, id, (lesson) => ({
      ...lesson,
      ...(title === undefined ? {} : { title }),
      ...(position === undefined ? {} : { position }),
    }));
  }

  /**
   * Enregistre le contenu : refusé s'il sort du schéma fermé (R4, jamais nettoyé en silence) ou s'il
   * cite un média qui n'appartient pas à ce cours (R3 : l'accès au média suit celui du cours).
   */
  async saveContent(actor: Actor, id: LessonId, raw: unknown): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.edit-lesson", id);
    const validation = validateLessonContent(raw);
    if (!validation.ok) {
      const [problem] = validation.problems;
      throw new InvalidLessonContentError(problem?.path ?? "$", problem?.code ?? "invalid");
    }
    const content = validation.value;
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const lesson = await store.lessonById(id);
      if (lesson === null) throw new NotFoundError();
      const owned = new Set<string>((await store.mediaOfLesson(id)).map((media) => media.id));
      for (const mediaId of mediaIdsOf(content)) {
        if (!owned.has(mediaId)) throw new InvalidLessonContentError("$", "media-not-in-lesson");
      }
      await store.updateLesson({ ...lesson, content, updatedAt: this.deps.clock.now() });
    });
  }

  async publish(actor: Actor, id: LessonId): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.publish-lesson", id);
    const now = this.deps.clock.now();
    await this.#change(
      actor,
      id,
      (lesson) => {
        if (lesson.content === null) throw new EmptyLessonError();
        return { ...lesson, status: "published", publishedAt: lesson.publishedAt ?? now, updatedAt: now };
      },
      "curriculum.lesson-published",
    );
  }

  /** Repasser en brouillon : le cours redevient invisible pour les élèves, même déverrouillé (R3). */
  async unpublish(actor: Actor, id: LessonId): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.publish-lesson", id);
    await this.#change(
      actor,
      id,
      (lesson) => ({ ...lesson, status: "draft", updatedAt: this.deps.clock.now() }),
      "curriculum.lesson-unpublished",
    );
  }

  async #change(
    actor: Actor,
    id: LessonId,
    apply: (lesson: LessonRecord) => LessonRecord,
    auditAction?: AuditAction,
  ): Promise<void> {
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const lesson = await store.lessonById(id);
      if (lesson === null) throw new NotFoundError();
      await store.updateLesson(apply(lesson));
      if (auditAction !== undefined)
        await store.audit(auditOf(this.deps, actor, auditAction, "success", { targetId: id }));
    });
  }
}
