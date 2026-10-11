import { randomBytes } from "node:crypto";

/**
 * UUID version 7 (RFC 9562) : 48 bits d'horodatage en millisecondes, puis 74 bits aléatoires
 * issus d'un générateur cryptographique. Non devinable, et croissant dans le temps.
 */
export function uuidv7(nowMs: number): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f); // version 7
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // variante RFC 9562
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
