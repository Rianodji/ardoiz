import type { AuthSessionId, GuardianId, LearnerId, TutorId, TutorSpaceId } from "../../shared-kernel/ids.js";

interface ActorBase {
  readonly tutorSpaceId: TutorSpaceId;
  readonly sessionId: AuthSessionId;
  /** Dernière preuve d'identité : sert à la réauthentification des actions sensibles (R7). */
  readonly authenticatedAt: Date;
}

export interface TutorActor extends ActorBase {
  readonly kind: "tutor";
  readonly id: TutorId;
  readonly mfaEnrolled: boolean;
}

export interface GuardianActor extends ActorBase {
  readonly kind: "guardian";
  readonly id: GuardianId;
  readonly mfaEnrolled: boolean;
  /** Élèves auxquels le parent est lié par un lien actif. */
  readonly learnerIds: ReadonlySet<LearnerId>;
}

export interface LearnerActor extends ActorBase {
  readonly kind: "learner";
  readonly id: LearnerId;
}

/**
 * Qui agit. Construit par l'infrastructure à partir de la session et de la base, jamais à partir
 * du corps, des paramètres ou du front (règle 2, ADR-0006). Exposé à tous les modules par index.ts.
 */
export type Actor = TutorActor | GuardianActor | LearnerActor;
