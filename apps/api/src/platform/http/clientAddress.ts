import { isIPv4, isIPv6 } from "node:net";

/**
 * Adresse tronquée, seule forme stockée (avec la session) : /24 en IPv4, /48 en IPv6.
 * Assez pour reconnaître « la maison » ou « le bureau », pas pour identifier une personne (minimisation).
 */
export function truncateIp(ip: string): string | null {
  const mapped = ip.startsWith("::ffff:") && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (isIPv4(mapped)) return `${mapped.split(".").slice(0, 3).join(".")}.0/24`;
  if (!isIPv6(mapped)) return null;
  const [head = "", tail = ""] = mapped.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const groups = mapped.includes("::")
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 3)
    .map((group) => Number.parseInt(group || "0", 16).toString(16))
    .join(":")}::/48`;
}

/**
 * Clé de limitation de débit d'une adresse (R8) : l'IPv4 entière ; en IPv6, le préfixe /64, car
 * un abonné dispose d'au moins un /64 et peut changer d'adresse à chaque essai (verdict L1, R-5).
 * Utilisée en mémoire seulement, jamais stockée ni journalisée.
 */
export function throttleKeyForIp(ip: string): string {
  const mapped = ip.startsWith("::ffff:") && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (!isIPv6(mapped)) return mapped;
  const [head = "", tail = ""] = mapped.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const groups = mapped.includes("::")
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || "0", 16).toString(16))
    .join(":")}::/64`;
}

/** Agent utilisateur abrégé : il aide à reconnaître une session, sans servir d'empreinte détaillée. */
export function shortUserAgent(userAgent: string | undefined): string | null {
  if (userAgent === undefined || userAgent.trim() === "") return null;
  return userAgent.replace(/[^\x20-\x7e]/g, "").slice(0, 200);
}
