/** L'heure de référence est toujours celle du serveur, injectée (R5, M6) : jamais `Date.now()` dans le domaine. */
export interface Clock {
  now(): Date;
}
