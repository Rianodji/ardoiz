import { inspect } from "node:util";

/**
 * Enveloppe d'un secret (R20). Sa valeur n'apparaît que par un appel explicite à `reveal()` :
 * un log, un `JSON.stringify` ou une trace d'erreur affichent « [secret] ».
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "[secret]";
  }

  toJSON(): string {
    return "[secret]";
  }

  [inspect.custom](): string {
    return "Secret([secret])";
  }
}
