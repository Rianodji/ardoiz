import type { LoginThrottle, ThrottleDecision } from "../application/ports.js";

interface Counter {
  /** Instants des échecs encore comptés, du plus ancien au plus récent. */
  readonly at: readonly number[];
}

const failuresOf = (counter: Counter): number => counter.at.length;
const lastFailureOf = (counter: Counter): number => counter.at[counter.at.length - 1] ?? 0;

// QUESTION Q11 : le catalogue dit « ralentie puis bloquée » sans chiffres. Option restrictive :
// jusqu'à 4 échecs, aucune attente ; du 5e au 9e, attente qui double (30 s, 1 min, 2 min…) ;
// à partir du 10e, blocage de 15 minutes. Un succès remet le compteur de l'identifiant à zéro.
const FREE_FAILURES = 4;
const BLOCK_AFTER = 10;
const BASE_DELAY_MS = 30_000;
const BLOCK_MS = 15 * 60_000;
/** Un compteur sans nouvel échec pendant ce délai est oublié. */
const FORGET_AFTER_MS = 60 * 60_000;
/**
 * Échecs TOTP d'un compte : comptés sur 24 h glissantes, pour que l'alarme du 10e échec parte même
 * contre un attaquant patient qui espace ses essais (verdict L1, reliquat de R-1). Un redémarrage
 * remet le compteur à zéro (accepté au J1 : l'audit « identity.tutor-login failed » reste la trace).
 */
const MFA_ACCOUNT_WINDOW_MS = 24 * 60 * 60_000;
const isSlidingKey = (key: string): boolean => key.startsWith("mfa-account:");

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
      this.#counters.set(key, { at: [...(counter?.at ?? []), now.getTime()] });
    }
    if (this.#counters.size > 100_000) this.#prune(now.getTime());
  }

  failureCount(key: string, now: Date): number {
    const counter = this.#current(key, now.getTime());
    return counter === undefined ? 0 : failuresOf(counter);
  }

  recordSuccess(keys: readonly string[]): void {
    for (const key of keys) this.#counters.delete(key);
  }

  #waitFor(key: string, now: number): number {
    const counter = this.#current(key, now);
    if (counter === undefined) return 0;
    const failures = failuresOf(counter);
    const lastFailureAt = lastFailureOf(counter);
    if (key.startsWith("ip:")) return failures >= IP_MAX_FAILURES ? lastFailureAt + FORGET_AFTER_MS - now : 0;
    if (failures <= FREE_FAILURES) return 0;
    const delay = failures >= BLOCK_AFTER ? BLOCK_MS : BASE_DELAY_MS * 2 ** (failures - FREE_FAILURES - 1);
    return lastFailureAt + delay - now;
  }

  #current(key: string, now: number): Counter | undefined {
    const counter = this.#counters.get(key);
    if (counter === undefined) return undefined;
    // Compteur TOTP d'un compte : fenêtre glissante de 24 h. Autres clés : oubliées 1 h après le dernier échec.
    const kept = isSlidingKey(key)
      ? counter.at.filter((at) => now - at <= MFA_ACCOUNT_WINDOW_MS)
      : now - lastFailureOf(counter) > FORGET_AFTER_MS
        ? []
        : counter.at;
    if (kept.length === 0) {
      this.#counters.delete(key);
      return undefined;
    }
    if (kept.length !== counter.at.length) this.#counters.set(key, { at: kept });
    return { at: kept };
  }

  #prune(now: number): void {
    for (const key of [...this.#counters.keys()]) this.#current(key, now);
  }
}
