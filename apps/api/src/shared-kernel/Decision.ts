import { ForbiddenError, NotFoundError } from "./DomainError.js";

/**
 * Décision d'une politique d'accès (ADR-0010) :
 * - `allow` : autorisé ;
 * - `deny`  : refusé, l'acteur peut savoir que la ressource existe (403) ;
 * - `hide`  : refusé, l'acteur ne doit pas apprendre que la ressource existe (404).
 * Il n'existe aucune autre valeur : pas de « autoriser par défaut » (R18).
 */
export type Decision =
  { readonly kind: "allow" } | { readonly kind: "deny"; readonly reason: string } | { readonly kind: "hide" };

export const allow = (): Decision => ({ kind: "allow" });
export const deny = (reason: string): Decision => ({ kind: "deny", reason });
export const hide = (): Decision => ({ kind: "hide" });

export function assertNever(value: never): never {
  throw new Error(`Cas non prévu : ${JSON.stringify(value)}`);
}

/**
 * Applique une décision. Le `switch` est exhaustif : ajouter une variante sans la traiter
 * ne compile pas, et une valeur inattendue à l'exécution lève une erreur, donc un refus (R18, M16).
 */
export function enforce(decision: Decision): void {
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
      throw new ForbiddenError(decision.reason);
    case "hide":
      throw new NotFoundError();
    default:
      return assertNever(decision);
  }
}
