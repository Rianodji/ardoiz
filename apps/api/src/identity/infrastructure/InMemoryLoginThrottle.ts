import type { LoginThrottle, ThrottleDecision } from "../application/ports.js";

interface Counter {
  failures: number;
  lastFailureAt: number;
}

// QUESTION Q11 : le catalogue dit « ralentie puis bloquée » sans chiffres. Option restrictive :
// jusqu'à 4 échecs, aucune attente ; du 5e au 9e, attente qui double (30 s, 1 min, 2 min…) ;
// à partir du 10e, blocage de 15 minutes. Un succès remet le compteur de l'identifiant à zéro.
const FREE_FAILURES = 4;
const BLOCK_AFTER = 10;
const BASE_DELAY_MS = 30_000;
const BLOCK_MS = 15 * 60_000;
/** Un compteur sans nouvel échec pendant ce délai est oublié. */
const FORGET_AFTER_MS = 60 * 60_000;
/** Par adresse IP : 30 échecs par heure, quels que soient les identifiants (pulvérisation). */
const IP_MAX_FAILURES = 30;

/**
 * Limitation des tentatives (R8, M9), en mémoire : une seule instance tourne (HANDOFF_INFRA.md).
 * Les clés sont l'identifiant tenté (qu'il existe ou non : pas d'énumération) et l'adresse IP ;
 * aucune n'est écrite sur disque ni dans les journaux.
 */
export class InMemoryLoginThrottle implements LoginThrottle {
  readonly #counters = new Map<string, Counter>();

  check(keys: readonly string[], now: Date): ThrottleDecision {
    let waitMs = 0;
    for (const key of keys) waitMs = Math.max(waitMs, this.#waitFor(key, now.getTime()));
    return waitMs <= 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }

  recordFailure(keys: readonly string[], now: Date): void {
    for (const key of keys) {
      const counter = this.#current(key, now.getTime());
      this.#counters.set(key, { failures: (counter?.failures ?? 0) + 1, lastFailureAt: now.getTime() });
    }
    if (this.#counters.size > 100_000) this.#prune(now.getTime());
  }

  recordSuccess(keys: readonly string[]): void {
    for (const key of keys) this.#counters.delete(key);
  }

  #waitFor(key: string, now: number): number {
    const counter = this.#current(key, now);
    if (counter === undefined) return 0;
    if (key.startsWith("ip:"))
      return counter.failures >= IP_MAX_FAILURES ? counter.lastFailureAt + FORGET_AFTER_MS - now : 0;
    if (counter.failures <= FREE_FAILURES) return 0;
    const delay =
      counter.failures >= BLOCK_AFTER
        ? BLOCK_MS
        : BASE_DELAY_MS * 2 ** (counter.failures - FREE_FAILURES - 1);
    return counter.lastFailureAt + delay - now;
  }

  #current(key: string, now: number): Counter | undefined {
    const counter = this.#counters.get(key);
    if (counter !== undefined && now - counter.lastFailureAt > FORGET_AFTER_MS) {
      this.#counters.delete(key);
      return undefined;
    }
    return counter;
  }

  #prune(now: number): void {
    for (const [key, counter] of this.#counters)
      if (now - counter.lastFailureAt > FORGET_AFTER_MS) this.#counters.delete(key);
  }
}
