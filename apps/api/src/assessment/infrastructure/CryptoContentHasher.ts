import { createHash, randomBytes, randomInt } from "node:crypto";
import type { RandomSource } from "../../shared-kernel/Clock.js";
import type { ContentHasher } from "../application/ports.js";

/** Empreinte SHA-256 d'une copie figée (R6). */
export class CryptoContentHasher implements ContentHasher {
  sha256(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }
}

/** Aléa cryptographique : ordre des options et alias opaques imprévisibles (ADR-0007). */
export class CryptoRandomSource implements RandomSource {
  integer(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }

  token(): string {
    return randomBytes(9).toString("base64url");
  }
}
