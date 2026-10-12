import type { World } from "./world.js";

/** Déclaration de consentement au texte en vigueur, telle que l'envoie la page de consentement. */
export async function currentConsentSync(
  world: World,
): Promise<{ accepted: true; version: string; sha256: string }> {
  const consent = await world.http({ method: "GET", url: "/api/legal/consentement" });
  const { version, sha256 } = consent.body as { version: string; sha256: string };
  return { accepted: true, version, sha256 };
}
