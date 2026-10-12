import type { RequestQuota } from "../application/ports.js";

/**
 * Quota en mémoire sur une fenêtre glissante (une seule instance tourne, HANDOFF_INFRA.md).
 * Les clés ne sont ni écrites sur disque ni journalisées.
 */
export class InMemoryRequestQuota implements RequestQuota {
  readonly #hits = new Map<string, number[]>();

  take(key: string, limit: number, windowMs: number, now: Date): boolean {
    const since = now.getTime() - windowMs;
    const recent = (this.#hits.get(key) ?? []).filter((at) => at > since);
    if (recent.length >= limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now.getTime());
    this.#hits.set(key, recent);
    if (this.#hits.size > 100_000) this.#prune(since);
    return true;
  }

  #prune(since: number): void {
    for (const [key, hits] of this.#hits) if (hits.every((at) => at <= since)) this.#hits.delete(key);
  }
}
