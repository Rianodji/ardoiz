import { hash, verify } from "@node-rs/argon2";
import type { PasswordHasher } from "../application/ports.js";

/** Paramètres OWASP actuels pour argon2id : 19 Mio, 2 passes, 1 fil (ADR-0006). */
// `algorithm: 2` = Algorithm.Argon2id (énumération « const » non importable avec verbatimModuleSyntax).
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PasswordHasher implements PasswordHasher {
  readonly #dummyHash: Promise<string>;

  constructor() {
    // Hash factice calculé une fois : la vérification d'un compte inexistant coûte autant qu'une vraie (R8).
    this.#dummyHash = hash("ardoiz-compte-inexistant", OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    await verify(await this.#dummyHash, password);
  }
}
