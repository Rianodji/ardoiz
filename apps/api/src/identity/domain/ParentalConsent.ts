import type { GuardianId, LearnerId, ParentalConsentId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { ConsentRequiredError } from "./errors.js";

/** Texte de consentement en vigueur : identifiant de version et empreinte SHA-256 du texte (R16). */
export interface ConsentText {
  readonly version: string;
  readonly sha256: string;
}

/** Ce que le parent déclare accepter, tel qu'envoyé par l'interface. */
export interface ConsentDeclaration {
  readonly accepted: boolean;
  readonly version: string;
  readonly sha256: string;
}

/**
 * Trace du consentement parental (R16, M11). `learnerId` vaut null pour le consentement donné
 * à l'acceptation de l'invitation, avant la création des enfants.
 */
export interface ParentalConsent {
  readonly id: ParentalConsentId;
  readonly tutorSpaceId: TutorSpaceId;
  readonly guardianId: GuardianId;
  readonly learnerId: LearnerId | null;
  readonly textVersion: string;
  readonly textSha256: string;
  readonly givenAt: Date;
  readonly withdrawnAt: Date | null;
}

/**
 * Le consentement ne vaut que pour le texte en vigueur, lu par le parent : même version et même
 * empreinte. Un texte modifié est une nouvelle version, donc un nouveau consentement (docs/juridique).
 */
export function requireCurrentConsent(declaration: ConsentDeclaration, current: ConsentText): ConsentText {
  if (
    !declaration.accepted ||
    declaration.version !== current.version ||
    declaration.sha256 !== current.sha256
  ) {
    throw new ConsentRequiredError();
  }
  return current;
}
