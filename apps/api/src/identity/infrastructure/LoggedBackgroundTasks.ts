import type { FastifyBaseLogger } from "fastify";
import type { BackgroundTasks } from "../application/ports.js";

/**
 * Tâches lancées après la réponse. Un échec est journalisé au niveau « error » avec son code
 * stable (repérable par une alerte Loki au L7) et le seul type d'erreur : ni destinataire, ni
 * message du fournisseur (R21). La décision du lead (verdict L1, R-2) fait de l'alerte de connexion
 * un contrôle de détection, envoyé au mieux ; l'envoi durable par l'outbox viendra au L3.
 */
export class LoggedBackgroundTasks implements BackgroundTasks {
  readonly #pending = new Set<Promise<void>>();

  constructor(private readonly log: FastifyBaseLogger) {}

  run(failureCode: string, task: () => Promise<void>): void {
    const running = task()
      .catch((error: unknown) => {
        this.log.error(
          { code: failureCode, errorType: error instanceof Error ? error.name : typeof error },
          "tâche de fond en échec",
        );
      })
      .finally(() => {
        this.#pending.delete(running);
      });
    this.#pending.add(running);
  }

  /** Attend la fin des tâches en cours (arrêt propre du serveur, tests). */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}
