import { allow, assertNever, deny, hide, type Decision } from "../../shared-kernel/Decision.js";
import type { LearnerId } from "../../shared-kernel/ids.js";
import type { Actor } from "./Actor.js";

/**
 * Politiques d'accès d'`identity` (R2), transcription de docs/securite/matrice-des-droits.md.
 * Chaque fonction couvre tous les acteurs (switch exhaustif) : rien n'est autorisé par défaut (R18).
 * `hide` (404) quand l'acteur ne doit pas apprendre que l'élève existe ; `deny` (403) sinon.
 */

const linkedTo = (actor: Actor & { kind: "guardian" }, learnerId: LearnerId) =>
  actor.learnerIds.has(learnerId);

/**
 * Élève visé par une action. `existsInSpace` vient de la base, sous RLS : un élève absent de
 * l'espace de l'acteur (inexistant, ou d'un autre espace) est 👻 pour TOUS, y compris pour un
 * tuteur qui aurait sinon reçu 403 (R2, R10 : le tuteur d'un autre espace est 👻 partout).
 */
export interface LearnerTarget {
  readonly learnerId: LearnerId;
  readonly existsInSpace: boolean;
}

export function canInviteGuardian(actor: Actor): Decision {
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

/** Un parent crée l'élève ; le tuteur n'en a pas l'autorité (ADR-0003). */
export function canCreateLearner(actor: Actor): Decision {
  switch (actor.kind) {
    case "guardian":
      return allow();
    case "tutor":
    case "learner":
      return deny("guardian-only");
    default:
      return assertNever(actor);
  }
}

/** Co-parent : uniquement pour SES enfants (R1, hotspot H1). */
export function canInviteCoGuardian(actor: Actor, target: LearnerTarget): Decision {
  if (!target.existsInSpace) return hide();
  const { learnerId } = target;
  switch (actor.kind) {
    case "guardian":
      return linkedTo(actor, learnerId) ? allow() : hide();
    case "tutor":
      return deny("guardian-only");
    case "learner":
      return actor.id === learnerId ? deny("guardian-only") : hide();
    default:
      return assertNever(actor);
  }
}

/** Révoquer un lien parental : le tuteur, ou un parent lié à l'élève de ce lien. */
export function canRevokeGuardianship(actor: Actor, target: LearnerTarget): Decision {
  if (!target.existsInSpace) return hide();
  const { learnerId } = target;
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
      return linkedTo(actor, learnerId) ? allow() : hide();
    case "learner":
      return actor.id === learnerId ? deny("adult-only") : hide();
    default:
      return assertNever(actor);
  }
}

export function canResetLearnerPassword(actor: Actor, target: LearnerTarget): Decision {
  return canRevokeGuardianship(actor, target);
}

/** Voir le profil d'un élève : le tuteur, ses parents liés, lui-même. */
export function canViewLearner(actor: Actor, target: LearnerTarget): Decision {
  if (!target.existsInSpace) return hide();
  const { learnerId } = target;
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
      return linkedTo(actor, learnerId) ? allow() : hide();
    case "learner":
      return actor.id === learnerId ? allow() : hide();
    default:
      return assertNever(actor);
  }
}

/** Retirer son consentement : seul un parent lié (le tuteur ne consent pas à la place des parents). */
export function canWithdrawConsent(actor: Actor, target: LearnerTarget): Decision {
  if (!target.existsInSpace) return hide();
  const { learnerId } = target;
  switch (actor.kind) {
    case "guardian":
      return linkedTo(actor, learnerId) ? allow() : hide();
    case "tutor":
      return deny("guardian-only");
    case "learner":
      return deny("guardian-only");
    default:
      return assertNever(actor);
  }
}

export function canReadAuditTrail(actor: Actor): Decision {
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

/** Liste des familles de l'espace (écran de gestion du tuteur). */
export function canListFamilies(actor: Actor): Decision {
  return canReadAuditTrail(actor);
}
