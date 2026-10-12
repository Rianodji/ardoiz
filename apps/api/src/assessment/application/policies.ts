import type { Actor } from "../../identity/index.js";
import { allow, assertNever, deny, hide, type Decision } from "../../shared-kernel/Decision.js";
import type { LearnerId } from "../../shared-kernel/ids.js";

/**
 * Politiques d'accès de l'évaluation (R2, R5), transcription de la matrice des droits.
 * Switch exhaustifs, aucune branche « autoriser par défaut » (R18).
 */

/** Créer, modifier une épreuve ; l'attribuer ; corriger, publier, rectifier : le tuteur seul. */
export function canAuthorOrGrade(actor: Actor): Decision {
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

/**
 * Commencer une tentative, enregistrer un brouillon, rendre : l'élève concerné seulement (la fenêtre
 * est contrôlée ensuite). Parent lié 🚫 ; parent non lié 👻 ; autre élève 👻 ; tuteur 🚫.
 */
export function canWorkOnAssignment(actor: Actor, assignedLearners: ReadonlySet<LearnerId> | null): Decision {
  if (assignedLearners === null) return hide();
  switch (actor.kind) {
    case "learner":
      return assignedLearners.has(actor.id) ? allow() : hide();
    case "guardian":
      return [...actor.learnerIds].some((learnerId) => assignedLearners.has(learnerId))
        ? deny("learner-only")
        : hide();
    case "tutor":
      return deny("learner-only");
    default:
      return assertNever(actor);
  }
}

/**
 * Voir une copie (et, publiée, son corrigé) : le tuteur ; l'élève, la sienne ; un parent lié,
 * seulement après la publication. Tout autre cas 👻.
 */
export function canViewAttempt(
  actor: Actor,
  attempt: { learnerId: LearnerId; published: boolean } | null,
): Decision {
  if (attempt === null) return hide();
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "learner":
      return actor.id === attempt.learnerId ? allow() : hide();
    case "guardian":
      return actor.learnerIds.has(attempt.learnerId) && attempt.published ? allow() : hide();
    default:
      return assertNever(actor);
  }
}

/** Voir les résultats publiés d'un élève : le tuteur (élève de son espace), ses parents liés, lui-même. */
export function canViewResults(actor: Actor, learnerId: LearnerId, learnerInSpace: boolean): Decision {
  if (!learnerInSpace) return hide();
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
