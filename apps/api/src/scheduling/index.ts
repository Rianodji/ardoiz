/**
 * API publique du module scheduling (règle 12). L'événement « SéanceRejointe » est publié dans
 * l'outbox sous le type exporté ici ; le module progress le consommera au lot L6.
 */
export { SESSION_JOINED } from "./application/SchedulingService.js";
export {
  createSchedulingModule,
  type SchedulingModule,
  type SchedulingModuleOptions,
} from "./infrastructure/module.js";
