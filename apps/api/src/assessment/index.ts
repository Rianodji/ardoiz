/**
 * API publique du module assessment (règle 12). L'événement « CorrectionPubliée » est publié dans
 * l'outbox sous le type exporté ici ; le module progress le consommera au lot L6.
 */
export { ANSWERS_REVEALED, CORRECTION_PUBLISHED } from "./application/publication.js";
export {
  createAssessmentModule,
  type AssessmentModule,
  type AssessmentModuleOptions,
} from "./infrastructure/module.js";
