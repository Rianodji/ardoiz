import { DomainError } from "../../shared-kernel/DomainError.js";

/** Donnée saisie invalide : le code dit quel champ, jamais la valeur reçue. */
export class InvalidIdentityInput extends DomainError {
  constructor(readonly code: `identity.invalid-${string}`) {
    super(`Saisie invalide (${code}).`);
  }
}

export class WeakPasswordError extends DomainError {
  readonly code = "identity.weak-password";

  constructor(readonly reason: "too-short" | "too-long" | "common" | "contains-identifier") {
    super(`Mot de passe refusé (${reason}).`);
  }
}

/** Un élève garde toujours au moins un lien parental actif (contextes.md §5). */
export class LastGuardianshipError extends DomainError {
  readonly code = "identity.last-guardianship";

  constructor() {
    super("Impossible de retirer le dernier lien parental d'un élève ; retirer le consentement à la place.");
  }
}

export class ConsentRequiredError extends DomainError {
  readonly code = "identity.consent-required";

  constructor() {
    super("Le consentement parental, dans sa version en vigueur, est obligatoire (R16).");
  }
}

export class AlreadyTakenError extends DomainError {
  constructor(readonly code: "identity.email-taken" | "identity.username-taken") {
    super(`Valeur déjà utilisée (${code}).`);
  }
}

export class AccountDisabledError extends DomainError {
  readonly code = "identity.account-disabled";

  constructor() {
    super("Compte désactivé.");
  }
}
