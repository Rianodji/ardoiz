import { InvalidSchedulingInput } from "./errors.js";

/**
 * Lien de visio (glossaire : `MeetingLink`, R9, M10) : une URL `https:` dont l'hôte figure dans une
 * liste blanche fermée — Jitsi public, Google Meet, Zoom — plus, éventuellement, UN hôte Jitsi fixé par
 * la configuration (Q5). Ni identifiants dans l'URL, ni port, ni autre schéma (`http:`, `javascript:`).
 */
export const ALLOWED_MEETING_HOSTS = ["meet.jit.si", "meet.google.com"] as const;
const ZOOM_DOMAIN = "zoom.us";
const MAX_LENGTH = 500;

export class MeetingLink {
  private constructor(readonly href: string) {}

  static parse(raw: unknown, extraHost: string | null): MeetingLink {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH || hasControlOrSpace(raw)) {
      throw new InvalidSchedulingInput("scheduling.invalid-link");
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new InvalidSchedulingInput("scheduling.invalid-link");
    }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
      throw new InvalidSchedulingInput("scheduling.invalid-link");
    }
    if (!isAllowedHost(url.hostname, extraHost)) throw new InvalidSchedulingInput("scheduling.invalid-link");
    return new MeetingLink(url.href);
  }

  /**
   * Salle Jitsi générée par Ardoiz : un nom imprévisible (au moins 128 bits d'aléa), pour qu'un lien
   * deviné ne mène à aucune séance. Sert aussi à la régénération après une fuite (M10).
   */
  static generatedJitsi(randomToken: string): MeetingLink {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(randomToken))
      throw new InvalidSchedulingInput("scheduling.invalid-link");
    return new MeetingLink(`https://meet.jit.si/ardoiz-${randomToken}`);
  }
}

/** Caractère de contrôle ou espace : jamais dans un lien (testé par point de code). */
function hasControlOrSpace(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/.test(char)) return true;
  }
  return false;
}

function isAllowedHost(hostname: string, extraHost: string | null): boolean {
  const host = hostname.toLowerCase();
  if ((ALLOWED_MEETING_HOSTS as readonly string[]).includes(host)) return true;
  // Zoom attribue un sous-domaine par compte (us02web.zoom.us) : le domaine exact, ou un sous-domaine.
  if (host === ZOOM_DOMAIN || host.endsWith(`.${ZOOM_DOMAIN}`)) return true;
  return extraHost !== null && host === extraHost.toLowerCase();
}
