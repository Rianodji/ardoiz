import type { Actor } from "../../identity/index.js";
import { allow, assertNever, deny, hide, type Decision } from "../../shared-kernel/Decision.js";
import type { LearnerId } from "../../shared-kernel/ids.js";

/**
 * Politiques de la planification (R2, R9), transcription de la matrice des droits. Switch exhaustifs,
 * aucune branche « autoriser par défaut » (R18). `participants` vaut null si la séance n'existe pas.
 */

/** Planifier, déplacer, annuler une séance, changer son lien : le tuteur seul. */
export function canPlan(actor: Actor): Decision {
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

/** Voir une séance, sans lien : le tuteur, l'élève participant, le parent d'un enfant participant. */
export function canSeeSession(actor: Actor, participants: ReadonlySet<LearnerId> | null): Decision {
  if (participants === null) return hide();
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "learner":
      return participants.has(actor.id) ? allow() : hide();
    case "guardian":
      return [...actor.learnerIds].some((id) => participants.has(id)) ? allow() : hide();
    default:
      return assertNever(actor);
  }
}

/**
 * Obtenir le lien de visio (R9) : le tuteur toujours ; l'élève participant (la fenêtre est vérifiée
 * ensuite) ; le parent d'un enfant participant JAMAIS (🚫) — il voit la séance, pas le lien.
 */
export function canObtainLink(actor: Actor, participants: ReadonlySet<LearnerId> | null): Decision {
  if (participants === null) return hide();
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "learner":
      return participants.has(actor.id) ? allow() : hide();
    case "guardian":
      return [...actor.learnerIds].some((id) => participants.has(id)) ? deny("guardian-no-link") : hide();
    default:
      return assertNever(actor);
  }
}
