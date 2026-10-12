/**
 * API publique du module identity (règle 12) : les autres modules n'importent que ce fichier.
 * Ils y trouvent l'`Actor` (qui agit, dans quel espace, quels élèves liés) et la façon de l'obtenir.
 */
export type { Actor, GuardianActor, LearnerActor, TutorActor } from "./application/Actor.js";
export { actorOf, registerAuthentication, type Access } from "./infrastructure/http/authentication.js";
export {
  createIdentityModule,
  type IdentityModule,
  type IdentityModuleOptions,
} from "./infrastructure/module.js";
export { PgLearnerDirectory } from "./infrastructure/PgLearnerDirectory.js";
