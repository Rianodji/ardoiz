// Fixture volontairement fautive : le noyau partagé dépend d'un module métier.
import { Guardian } from "../identity/domain/Guardian.ts";

export const clock = Guardian;
