/** L'heure de référence est toujours celle du serveur, injectée (R5, M6) : jamais `Date.now()` dans le domaine. */
export interface Clock {
  now(): Date;
}

/**
 * Source d'aléa : le domaine et l'application ne tirent jamais de hasard eux-mêmes (règle 11).
 * Sert à mélanger les options d'un QCM et à leur donner des identifiants opaques (ADR-0007).
 */
export interface RandomSource {
  /** Entier uniforme dans [0, maxExclusive). */
  integer(maxExclusive: number): number;
  /** Jeton opaque, imprévisible (identifiant d'option montré à l'élève). */
  token(): string;
}
