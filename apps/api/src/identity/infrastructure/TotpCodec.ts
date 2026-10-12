import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Secret } from "../../platform/config/Secret.js";
import type { TotpService } from "../application/ports.js";

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Tolérance d'un pas de part et d'autre : décalage d'horloge du téléphone. */
const WINDOW = 1;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31] ?? "";
  return output;
}

/** Code TOTP (RFC 6238, HMAC-SHA1, 6 chiffres) pour un pas de temps donné. */
export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * TOTP du tuteur et des parents (R7). Le secret est chiffré en AES-256-GCM avec TOTP_ENCRYPTION_KEY
 * (ADR-0006) ; un pas déjà utilisé est refusé, pour qu'un code intercepté ne serve pas deux fois.
 */
export class AesGcmTotpService implements TotpService {
  readonly #key: Buffer;

  constructor(
    key: Secret,
    private readonly issuer = "Ardoiz",
  ) {
    this.#key = Buffer.from(key.reveal(), "base64");
    if (this.#key.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY doit faire 32 octets.");
  }

  newSecret(label: string): { ciphertext: string; otpauthUri: string; secret: string } {
    const raw = randomBytes(20);
    const secret = base32Encode(raw);
    const uri = new URL(`otpauth://totp/${encodeURIComponent(`${this.issuer}:${label}`)}`);
    uri.searchParams.set("secret", secret);
    uri.searchParams.set("issuer", this.issuer);
    uri.searchParams.set("digits", String(DIGITS));
    uri.searchParams.set("period", String(STEP_SECONDS));
    return { ciphertext: this.#encrypt(raw), otpauthUri: uri.toString(), secret };
  }

  verify(ciphertext: string, code: string, now: Date, lastUsedStep: number | null): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const secret = this.#decrypt(ciphertext);
    const current = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
    for (let step = current - WINDOW; step <= current + WINDOW; step++) {
      if (lastUsedStep !== null && step <= lastUsedStep) continue; // rejeu refusé
      if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step;
    }
    return null;
  }

  #encrypt(plain: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [
      "v1",
      iv.toString("base64url"),
      body.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  #decrypt(ciphertext: string): Buffer {
    const [version, iv, body, tag] = ciphertext.split(".");
    if (version !== "v1" || iv === undefined || body === undefined || tag === undefined) {
      throw new Error("Secret TOTP chiffré illisible.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
  }
}
