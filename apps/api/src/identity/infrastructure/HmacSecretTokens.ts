import { createHmac, randomBytes } from "node:crypto";
import type { Secret } from "../../platform/config/Secret.js";
import type { SecretTokens } from "../application/ports.js";

/**
 * Jetons de 256 bits (sessions, invitations, réinitialisations ; R1, R8). En base, seule leur
 * empreinte HMAC-SHA-256 est stockée, avec un poivre (SESSION_SECRET) absent de la base :
 * une copie de la base ne suffit pas à fabriquer un cookie ou un lien valides.
 */
export class HmacSecretTokens implements SecretTokens {
  constructor(private readonly pepper: Secret) {}

  generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHmac("sha256", this.pepper.reveal()).update(token, "utf8").digest("hex");
  }

  recoveryCode(): string {
    return randomBytes(8).toString("hex");
  }
}
