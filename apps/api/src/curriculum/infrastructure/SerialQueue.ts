import { DomainError } from "../../shared-kernel/DomainError.js";

/** Le service d'import est occupé : réessayer plus tard (503, Retry-After). */
export class ImportBusyError extends DomainError {
  readonly code = "curriculum.import-busy";

  constructor(readonly retryAfterSeconds: number) {
    super("Un import d'image est déjà en cours.");
  }
}

/**
 * File d'attente en mémoire : une seule tâche à la fois (verdict L2, S-3). Une image de 40 mégapixels
 * décodée occupe environ 160 Mo ; le conteneur est limité à 512 Mo. Une tâche qui attend plus que
 * `maxWaitMs` sans avoir commencé est abandonnée avec `ImportBusyError`, et la file continue.
 */
export class SerialQueue {
  #tail: Promise<void> = Promise.resolve();

  constructor(private readonly maxWaitMs = 30_000) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tail = previous.then(() => done);

    return new Promise<T>((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => {
        if (started) return;
        started = true; // la tâche ne démarrera plus : son tour passera immédiatement
        reject(new ImportBusyError(Math.ceil(this.maxWaitMs / 1000)));
      }, this.maxWaitMs);
      void previous.then(async () => {
        if (started) {
          release();
          return;
        }
        started = true;
        clearTimeout(timer);
        try {
          resolve(await task());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          release();
        }
      });
    });
  }
}
