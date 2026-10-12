import { DomainError } from "../../shared-kernel/DomainError.js";

export class InvalidAssessmentInput extends DomainError {
  constructor(readonly code: `assessment.invalid-${string}`) {
    super(`Saisie invalide (${code}).`);
  }
}

/** Refus lié à la fenêtre ou au nombre de tentatives, toujours selon l'horloge du serveur (R5). */
export class AttemptRefusedError extends DomainError {
  constructor(
    readonly code:
      | "assessment.not-yet-open"
      | "assessment.closed"
      | "assessment.no-attempts-left"
      | "assessment.attempt-submitted"
      | "assessment.locked",
  ) {
    super(`Tentative refusée (${code}).`);
  }
}

/** Sauvegarde trop rapprochée de la précédente (R15). */
export class DraftTooFrequentError extends DomainError {
  readonly code = "http.too-many-requests";

  constructor(readonly retryAfterSeconds: number) {
    super("Sauvegarde trop fréquente.");
  }
}

export class GradingError extends DomainError {
  constructor(
    readonly code:
      | "assessment.not-gradable"
      | "assessment.grading-incomplete"
      | "assessment.reason-required"
      | "assessment.already-published"
      | "assessment.not-published",
  ) {
    super(`Correction impossible (${code}).`);
  }
}
