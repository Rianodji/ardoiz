import { DomainError } from "../../shared-kernel/DomainError.js";

export class InvalidSchedulingInput extends DomainError {
  constructor(readonly code: `scheduling.invalid-${string}`) {
    super(`Saisie invalide (${code}).`);
  }
}

/** Action impossible au regard de l'horloge du serveur ou de l'état de la séance. */
export class SchedulingConflictError extends DomainError {
  constructor(
    readonly code:
      | "scheduling.in-the-past"
      | "scheduling.already-ended"
      | "scheduling.cancelled"
      | "scheduling.link-not-available"
      | "scheduling.link-to-replace",
  ) {
    super(`Action impossible (${code}).`);
  }
}
