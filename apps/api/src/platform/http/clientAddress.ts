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

/** Agent utilisateur abrégé : il aide à reconnaître une session, sans servir d'empreinte détaillée. */
export function shortUserAgent(userAgent: string | undefined): string | null {
  if (userAgent === undefined || userAgent.trim() === "") return null;
  return userAgent.replace(/[^\x20-\x7e]/g, "").slice(0, 200);
}
