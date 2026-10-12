import type { GroupId, LearnerId, LessonId } from "../../shared-kernel/ids.js";
import { learnerCanAccessLesson } from "../domain/access.js";
import type { CurriculumStore, LessonRecord } from "./ports.js";

/** Ce qu'il faut savoir pour décider de l'accès aux cours (R3) : déverrouillages actifs et groupes. */
export interface AccessContext {
  readonly lessons: ReadonlyMap<LessonId, LessonRecord>;
  canAccess(lesson: LessonRecord, learnerId: LearnerId): boolean;
}

export async function loadAccessContext(store: CurriculumStore): Promise<AccessContext> {
  const [lessons, unlocks, groups] = await Promise.all([
    store.lessons(),
    store.activeUnlocks(),
    store.groups(),
  ]);
  const groupsOf = new Map<LearnerId, Set<GroupId>>();
  for (const group of groups) {
    for (const learnerId of group.learnerIds) {
      const set = groupsOf.get(learnerId) ?? new Set<GroupId>();
      set.add(group.id);
      groupsOf.set(learnerId, set);
    }
  }
  return {
    lessons: new Map(lessons.map((lesson) => [lesson.id, lesson])),
    canAccess: (lesson, learnerId) =>
      learnerCanAccessLesson(
        { lessonId: lesson.id, moduleId: lesson.moduleId, published: lesson.status === "published" },
        learnerId,
        groupsOf.get(learnerId) ?? new Set(),
        unlocks,
      ),
  };
}
