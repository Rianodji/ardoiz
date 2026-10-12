import { DomainError } from "../../shared-kernel/DomainError.js";

/** Donnée saisie invalide : le code dit quel champ, jamais la valeur reçue. */
export class InvalidCurriculumInput extends DomainError {
  constructor(readonly code: `curriculum.invalid-${string}`) {
    super(`Saisie invalide (${code}).`);
  }
}

/** Le contenu ne respecte pas le schéma fermé (R4) : refusé, jamais nettoyé en silence. */
export class InvalidLessonContentError extends DomainError {
  readonly code = "curriculum.invalid-content";

  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Contenu de cours refusé (${reason} en ${path}).`);
  }
}

export class EmptyLessonError extends DomainError {
  readonly code = "curriculum.empty-lesson";

  constructor() {
    super("Un cours sans contenu ne peut pas être publié.");
  }
}

export class CurriculumConflictError extends DomainError {
  constructor(
    readonly code: "curriculum.name-taken" | "curriculum.already-unlocked" | "curriculum.competency-archived",
  ) {
    super(`Conflit (${code}).`);
  }
}
