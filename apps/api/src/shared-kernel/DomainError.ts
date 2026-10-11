/**
 * Classe de base de toutes les erreurs métier.
 * Le `code` est stable : il sert à la traduction en réponse HTTP et au choix du message affiché.
 * Le message est destiné aux développeurs ; il n'est jamais renvoyé au client.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidIdentifierError extends DomainError {
  readonly code = "shared.invalid-identifier";

  constructor(readonly expectedPrefix: string) {
    super(`Identifiant invalide : préfixe attendu "${expectedPrefix}_".`);
  }
}

/** Ressource inexistante OU masquée : les deux cas sont indiscernables pour l'appelant (R2). */
export class NotFoundError extends DomainError {
  readonly code = "application.not-found";

  constructor() {
    super("Ressource introuvable.");
  }
}

/** Refus quand l'acteur peut savoir que la ressource existe (🚫 de la matrice des droits). */
export class ForbiddenError extends DomainError {
  readonly code = "application.forbidden";

  constructor(readonly reason: string) {
    super(`Action non autorisée (${reason}).`);
  }
}
