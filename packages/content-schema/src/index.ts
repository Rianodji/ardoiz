/**
 * Schéma fermé du contenu des cours (ADR-0005, R4).
 * Le validateur `validateLessonContent` et la liste blanche des nœuds sont livrés au lot L2 ;
 * le package existe dès L0 pour fixer la frontière : le front et l'API valideront avec le même code.
 */
export const LESSON_CONTENT_SCHEMA_VERSION = 0;
