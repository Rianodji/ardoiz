import type { GroupId, LearnerId, LessonId, ModuleId } from "../../shared-kernel/ids.js";

export type UnlockTarget =
  { readonly kind: "module"; readonly id: ModuleId } | { readonly kind: "lesson"; readonly id: LessonId };
export type UnlockAudience =
  { readonly kind: "learner"; readonly id: LearnerId } | { readonly kind: "group"; readonly id: GroupId };

export interface ActiveUnlock {
  readonly target: UnlockTarget;
  readonly audience: UnlockAudience;
}

export interface LessonAccessFacts {
  readonly lessonId: LessonId;
  readonly moduleId: ModuleId;
  readonly published: boolean;
}

/**
 * Règle d'accès d'un élève à un cours (R3, M5) : le cours est publié ET déverrouillé — lui-même ou son
 * module — pour l'élève ou pour l'un de ses groupes. Refus par défaut : sans déverrouillage actif,
 * pas d'accès ; un brouillon reste invisible même déverrouillé.
 */
export function learnerCanAccessLesson(
  lesson: LessonAccessFacts,
  learnerId: LearnerId,
  learnerGroups: ReadonlySet<GroupId>,
  activeUnlocks: readonly ActiveUnlock[],
): boolean {
  if (!lesson.published) return false;
  return activeUnlocks.some((unlock) => {
    const targetsLesson =
      (unlock.target.kind === "lesson" && unlock.target.id === lesson.lessonId) ||
      (unlock.target.kind === "module" && unlock.target.id === lesson.moduleId);
    const reachesLearner =
      (unlock.audience.kind === "learner" && unlock.audience.id === learnerId) ||
      (unlock.audience.kind === "group" && learnerGroups.has(unlock.audience.id));
    return targetsLesson && reachesLearner;
  });
}
