import { DomainError } from "../../shared-kernel/DomainError.js";

/**
 * Échec de connexion : une seule erreur, quelle qu'en soit la cause (compte inconnu, mauvais mot
 * de passe, compte désactivé, code TOTP faux). Rien ne permet de distinguer les cas (R8, M9).
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = "identity.invalid-credentials";

  constructor() {
    super("Identifiants invalides.");
  }
}

/** Trop d'essais : la connexion est ralentie puis bloquée (R8). */
export class TooManyAttemptsError extends DomainError {
  readonly code = "http.too-many-requests";

  constructor(readonly retryAfterSeconds: number) {
    super("Trop de tentatives.");
  }
}

/** Le tuteur n'a pas encore activé le TOTP : aucune action métier possible (R7, M8). */
export class MfaEnrollmentRequiredError extends DomainError {
  readonly code = "identity.mfa-enrollment-required";

  constructor() {
    super("Double authentification à activer avant toute action.");
  }
}

/** Action sensible : une preuve d'identité de moins de 10 minutes est exigée (R7). */
export class ReauthenticationRequiredError extends DomainError {
  readonly code = "identity.reauthentication-required";

  constructor() {
    super("Réauthentification requise.");
  }
}

export class InvalidTotpError extends DomainError {
  readonly code = "identity.invalid-totp";

  constructor() {
    super("Code de double authentification invalide.");
  }
}
