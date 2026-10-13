import type { Actor } from "../../identity/index.js";
import { allow, assertNever, deny, hide, type Decision } from "../../shared-kernel/Decision.js";
import type { LearnerId } from "../../shared-kernel/ids.js";

/**
 * Politiques de la progression (R2, R17), transcription de la matrice des droits. Switch exhaustifs,
 * aucune branche « autoriser par défaut » (R18).
 */

/** Voir le profil et la progression d'un élève : le tuteur, ses parents liés, lui-même ; sinon 👻. */
export function canViewProgress(actor: Actor, learnerId: LearnerId, learnerInSpace: boolean): Decision {
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

/** Ajuster un niveau de compétence, voir la synthèse de tous les élèves : le tuteur seul. */
export function canManageProgress(actor: Actor): Decision {
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
