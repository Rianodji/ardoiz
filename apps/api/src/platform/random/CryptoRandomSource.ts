import { randomBytes, randomInt } from "node:crypto";
import type { RandomSource } from "../../shared-kernel/Clock.js";

/** Aléa cryptographique : options mélangées, alias opaques (ADR-0007), salles de visio générées (M10). */
export class CryptoRandomSource implements RandomSource {
  integer(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }

  token(): string {
    return randomBytes(9).toString("base64url");
  }
}
