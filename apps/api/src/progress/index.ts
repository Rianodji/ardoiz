/**
 * API publique du module progress (règle 12) : progression des élèves (preuves, niveaux de compétence,
 * points, série, badges), alimentée par les événements des autres modules.
 */
export {
  createProgressModule,
  type ProgressModule,
  type ProgressModuleOptions,
} from "./infrastructure/module.js";
