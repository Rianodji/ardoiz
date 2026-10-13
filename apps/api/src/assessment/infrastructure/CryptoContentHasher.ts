import { createHash } from "node:crypto";
import type { ContentHasher } from "../application/ports.js";

/** Empreinte SHA-256 d'une copie figée (R6). */
export class CryptoContentHasher implements ContentHasher {
  sha256(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }
}
