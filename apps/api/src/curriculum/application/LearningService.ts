import type { LessonContent } from "@ardoiz/content-schema";
import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { LearnerId, LessonId, MediaId, SubjectId } from "../../shared-kernel/ids.js";
import { loadAccessContext } from "./accessContext.js";
import { canCompleteLesson, canReadLesson, canViewLearnerProgramme } from "./policies.js";
import type { CurriculumStore } from "./ports.js";
import { auditOf, authorize, type CurriculumDependencies } from "./support.js";

export interface LessonView {
  readonly id: LessonId;
  readonly title: string;
  readonly content: LessonContent;
}

/** Ce qu'un élève a débloqué, matière par matière, module par module, avec ce qu'il a terminé. */
export interface LearnerProgramme {
  readonly subjects: ReadonlyArray<{
    readonly id: SubjectId;
    readonly name: string;
    readonly modules: ReadonlyArray<{
      readonly id: string;
      readonly title: string;
      readonly lessons: ReadonlyArray<{
        readonly id: LessonId;
        readonly title: string;
        readonly completedAt: Date | null;
      }>;
    }>;
  }>;
}

/** Type d'événement d'intégration publié quand un élève termine un cours (big picture §3 : CoursTerminé). */
export const LESSON_COMPLETED = "curriculum.lesson-completed";

/**
 * Lecture des cours et des médias (R3), vues élève et parent, « marquer comme terminé ».
 * Un cours non publié ou non déverrouillé est 👻 : même réponse qu'un cours inexistant (R2, M5).
 */
export class LearningService {
  constructor(private readonly deps: CurriculumDependencies) {}

  async readLesson(actor: Actor, id: LessonId): Promise<LessonView> {
    const view = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const context = await loadAccessContext(store);
      const lesson = context.lessons.get(id);
      return {
        lesson,
        decision: canReadLesson(actor, {
          existsInSpace: lesson !== undefined,
          accessibleTo: (learnerId) => lesson !== undefined && context.canAccess(lesson, learnerId),
        }),
      };
    });
    await authorize(this.deps, actor, view.decision, "curriculum.read-lesson", id);
    // Le tuteur peut lire un brouillon vide : pas de contenu, rien à afficher.
    if (view.lesson?.content === null || view.lesson === undefined) throw new NotFoundError();
    return { id: view.lesson.id, title: view.lesson.title, content: view.lesson.content };
  }

  /** Média d'un cours : mêmes droits que le cours qui le contient (matrice, R3, R14). */
  async readMedia(actor: Actor, mediaId: MediaId): Promise<{ bytes: Buffer; sha256: string }> {
    const found = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const media = await store.mediaById(mediaId);
      const context = await loadAccessContext(store);
      const lesson = media === null ? undefined : context.lessons.get(media.lessonId);
      return {
        media,
        decision: canReadLesson(actor, {
          existsInSpace: media !== null && lesson !== undefined,
          accessibleTo: (learnerId) => lesson !== undefined && context.canAccess(lesson, learnerId),
        }),
      };
    });
    await authorize(this.deps, actor, found.decision, "curriculum.read-media", mediaId);
    if (found.media === null) throw new NotFoundError();
    return { bytes: await this.deps.files.read(actor.tutorSpaceId, mediaId), sha256: found.media.sha256 };
  }

  /** Le programme débloqué d'un élève : pour lui, ses parents liés, le tuteur. */
  async programmeOf(actor: Actor, learnerId: LearnerId): Promise<LearnerProgramme> {
    await authorize(
      this.deps,
      actor,
      canViewLearnerProgramme(actor, learnerId),
      "curriculum.read-learner-programme",
      learnerId,
    );
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => programme(store, learnerId));
  }

  /**
   * L'élève marque un cours comme terminé : une seule fois, et seulement un cours qu'il peut lire.
   * L'événement « CoursTerminé » part dans l'outbox, dans la même transaction (progression, L6).
   */
  async completeLesson(actor: Actor, id: LessonId): Promise<void> {
    await authorize(this.deps, actor, canCompleteLesson(actor), "curriculum.complete-lesson", id);
    if (actor.kind !== "learner") throw new NotFoundError();
    const learnerId = actor.id;
    const decision = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const context = await loadAccessContext(store);
      const lesson = context.lessons.get(id);
      const decided = canReadLesson(actor, {
        existsInSpace: lesson !== undefined,
        accessibleTo: (candidate) => lesson !== undefined && context.canAccess(lesson, candidate),
      });
      if (decided.kind !== "allow" || lesson === undefined) return decided;
      const now = this.deps.clock.now();
      const isNew = await store.insertCompletion({ learnerId, lessonId: id, completedAt: now });
      if (isNew) {
        const module = (await store.modules()).find((candidate) => candidate.id === lesson.moduleId);
        await store.publish({
          id: this.deps.ids.next("EventId"),
          type: LESSON_COMPLETED,
          tutorSpaceId: actor.tutorSpaceId,
          occurredAt: now,
          payload: {
            learnerId,
            lessonId: id,
            subjectId: module?.subjectId ?? null,
            completedAt: now.toISOString(),
          },
        });
        await store.audit(
          auditOf(this.deps, actor, "curriculum.lesson-completed", "success", { targetId: id }),
        );
      }
      return decided;
    });
    await authorize(this.deps, actor, decision, "curriculum.complete-lesson", id);
  }
}

async function programme(store: CurriculumStore, learnerId: LearnerId): Promise<LearnerProgramme> {
  const context = await loadAccessContext(store);
  const [subjects, modules, completions] = await Promise.all([
    store.subjects(),
    store.modules(),
    store.completionsOf([learnerId]),
  ]);
  const completedAt = new Map(completions.map((completion) => [completion.lessonId, completion.completedAt]));
  const accessible = [...context.lessons.values()]
    .filter((lesson) => context.canAccess(lesson, learnerId))
    .sort((a, b) => a.position - b.position);
  return {
    subjects: subjects
      .sort((a, b) => a.position - b.position)
      .map((subject) => ({
        id: subject.id,
        name: subject.name,
        modules: modules
          .filter((module) => module.subjectId === subject.id)
          .sort((a, b) => a.position - b.position)
          .map((module) => ({
            id: module.id,
            title: module.title,
            lessons: accessible
              .filter((lesson) => lesson.moduleId === module.id)
              .map((lesson) => ({
                id: lesson.id,
                title: lesson.title,
                completedAt: completedAt.get(lesson.id) ?? null,
              })),
          }))
          .filter((module) => module.lessons.length > 0),
      }))
      .filter((subject) => subject.modules.length > 0),
  };
}
