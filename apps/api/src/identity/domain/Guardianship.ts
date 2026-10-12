import type { GuardianId, GuardianshipId, LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { LastGuardianshipError } from "./errors.js";

/** Origine d'un lien parental : les deux seuls chemins autorisés par R1 (hotspot H1). */
export type GuardianshipOrigin = "learner_creation" | "co_guardian_invitation";

export interface Guardianship {
  readonly id: GuardianshipId;
  readonly tutorSpaceId: TutorSpaceId;
  readonly guardianId: GuardianId;
  readonly learnerId: LearnerId;
  readonly origin: GuardianshipOrigin;
  readonly establishedAt: Date;
  readonly revokedAt: Date | null;
}

export const isActive = (link: Guardianship): boolean => link.revokedAt === null;

/**
 * Révoque un lien. Un élève garde au moins un lien actif (contextes.md §5) : retirer le dernier
 * passe par le retrait du consentement, qui désactive l'élève (R16).
 */
export function revoke(
  target: Guardianship,
  linksOfLearner: readonly Guardianship[],
  now: Date,
): Guardianship {
  const others = linksOfLearner.filter((link) => link.id !== target.id && isActive(link));
  if (!isActive(target)) return target;
  if (others.length === 0) throw new LastGuardianshipError();
  return { ...target, revokedAt: now };
}
