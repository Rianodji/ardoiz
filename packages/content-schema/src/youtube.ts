import { YOUTUBE_ID } from "./schema.js";

const HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
]);

/**
 * Identifiant de vidéo extrait d'un lien YouTube collé par le tuteur (ou l'identifiant seul).
 * Seul l'identifiant est stocké ; le lecteur est toujours construit sur youtube-nocookie.com (R13).
 */
export function youtubeIdFrom(input: string): string | null {
  const trimmed = input.trim();
  if (YOUTUBE_ID.test(trimmed)) return trimmed;
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return null;
  const candidate =
    url.hostname === "youtu.be"
      ? url.pathname.slice(1)
      : url.pathname === "/watch"
        ? (url.searchParams.get("v") ?? "")
        : (/^\/(embed|shorts)\/([^/]+)$/.exec(url.pathname)?.[2] ?? "");
  return YOUTUBE_ID.test(candidate) ? candidate : null;
}

/** Adresse du lecteur intégré : domaine sans cookie, sans suggestions de fin (rel=0), chargé après un clic (R13). */
export function youtubeEmbedUrl(videoId: string): string | null {
  if (!YOUTUBE_ID.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1`;
}
