import type { Clock } from "../../src/shared-kernel/Clock.js";

/** Horloge de test : l'heure ne bouge que si le test la fait avancer. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  setTo(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
