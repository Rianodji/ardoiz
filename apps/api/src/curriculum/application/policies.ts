import type { Actor } from "../../identity/index.js";
import { allow, assertNever, deny, hide, type Decision } from "../../shared-kernel/Decision.js";
import type { LearnerId } from "../../shared-kernel/ids.js";

/**
 * Politiques d'accès du programme (R2, R3), transcription de la matrice des droits. Switch exhaustifs,
 * aucune branche « autoriser par défaut » (R18).
 */

/** Créer, modifier ou publier un cours ; gérer le référentiel, les groupes, les déverrouillages : le tuteur seul. */
export function canAuthor(actor: Actor): Decision {
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
    case "learner":
      return deny("tutor-only");
    default:
      return assertNever(actor);
  }
}

export interface LessonReadFacts {
  /** Le cours existe dans l'espace de l'acteur (lu sous RLS). */
  readonly existsInSpace: boolean;
  /** Le cours est publié ET déverrouillé pour cet élève (règle `learnerCanAccessLesson`). */
  readonly accessibleTo: (learnerId: LearnerId) => boolean;
}

/**
 * Lire un cours (et ses médias, « comme le cours qui le contient ») :
 * tuteur ✅ ; parent lié ✅ si déverrouillé pour un de ses enfants ; élève ✅ si déverrouillé pour lui ;
 * tout autre cas 👻, indiscernable d'un cours inexistant (R2, R3).
 */
export function canReadLesson(actor: Actor, facts: LessonReadFacts): Decision {
  if (!facts.existsInSpace) return hide();
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
      return [...actor.learnerIds].some((learnerId) => facts.accessibleTo(learnerId)) ? allow() : hide();
    case "learner":
      return facts.accessibleTo(actor.id) ? allow() : hide();
    default:
      return assertNever(actor);
  }
}

/** Voir ce qu'un élève a débloqué et terminé : le tuteur, ses parents liés, lui-même (matrice, R2). */
export function canViewLearnerProgramme(actor: Actor, learnerId: LearnerId): Decision {
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
      return actor.learnerIds.has(learnerId) ? allow() : hide();
    case "learner":
      return actor.id === learnerId ? allow() : hide();
    default:
      return assertNever(actor);
  }
}

/** Marquer un cours comme terminé : l'élève seul, pour lui-même. */
export function canCompleteLesson(actor: Actor): Decision {
  switch (actor.kind) {
    case "learner":
      return allow();
    case "tutor":
    case "guardian":
      return deny("learner-only");
    default:
      return assertNever(actor);
  }
}
