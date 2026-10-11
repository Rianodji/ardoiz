import type { Clock } from "../../shared-kernel/Clock.js";

/** Horloge du serveur : le seul endroit du code qui lit l'heure système. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
