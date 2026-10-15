import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { MESSAGE_CODES, messageFor } from "../src/api/messages";

const TUTOIEMENT = /\b(tu|ton|ta|tes|toi|te)\b|-toi\b/i;
const IMPERATIFS =
  /\b(Vérifie|Recharge|Saisis|Active|Choisis|Attends|Reviens|Préviens|Indique|Coche|Ajoute|Explique|fais|utilise|Réessaie)\b/;

describe("Messages d'erreur selon la personne (charte §7)", () => {
  it.each(MESSAGE_CODES)("le message %s vouvoie un adulte", (code) => {
    const text = messageFor(new ApiError(400, code), "adult");
    expect(text).not.toMatch(TUTOIEMENT);
    expect(text).not.toMatch(IMPERATIFS);
  });

  it("l'élève reste tutoyé, avec des phrases courtes qui disent quoi faire", () => {
    expect(messageFor(new ApiError(0, "network.unavailable"))).toBe(
      "Impossible de joindre Ardoiz. Vérifie ta connexion internet, puis réessaie.",
    );
    expect(messageFor(new ApiError(0, "network.unavailable"), "adult")).toBe(
      "Impossible de joindre Ardoiz. Vérifiez votre connexion internet, puis réessayez.",
    );
  });

  it("le message générique existe pour les deux, sans le texte du serveur", () => {
    expect(messageFor(new Error("relation does not exist"), "adult")).not.toContain("relation");
    expect(messageFor(new ApiError(500, "inconnu"), "adult")).toMatch(/Réessayez/);
  });
});
