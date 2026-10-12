/**
 * API publique du module curriculum (règle 12). L'événement « CoursTerminé » est publié dans
 * l'outbox sous le type exporté ici ; le module progress le consommera au lot L6.
 */
export { LESSON_COMPLETED } from "./application/LearningService.js";
export {
  createCurriculumModule,
  type CurriculumModule,
  type CurriculumModuleOptions,
} from "./infrastructure/module.js";
