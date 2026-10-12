import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSENT_FILE, CONSENT_VERSION } from "./FileConsentTexts.js";

export type LegalDocument = "mentions-legales" | "confidentialite" | "confidentialite-eleve" | "consentement";

const FILES: Readonly<Record<LegalDocument, string>> = {
  "mentions-legales": "mentions-legales.md",
  confidentialite: "politique-de-confidentialite.md",
  "confidentialite-eleve": "confidentialite-version-eleve.md",
  consentement: CONSENT_FILE,
};

export interface LegalText {
  readonly document: LegalDocument;
  readonly markdown: string;
  readonly version: string | null;
  readonly sha256: string;
}

/**
 * Textes juridiques rédigés par le lead (docs/juridique), lus une fois au démarrage et servis
 * tels quels : l'application ne les réécrit jamais (CLAUDE.md). Le front les rend en composants,
 * sans HTML brut (R4).
 */
export class LegalTexts {
  readonly #texts: ReadonlyMap<LegalDocument, LegalText>;

  constructor(legalDir: string) {
    this.#texts = new Map(
      (Object.entries(FILES) as Array<[LegalDocument, string]>).map(([document, file]) => {
        const markdown = readFileSync(join(legalDir, file), "utf8");
        const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
        return [
          document,
          { document, markdown, sha256, version: document === "consentement" ? CONSENT_VERSION : null },
        ];
      }),
    );
  }

  get(document: LegalDocument): LegalText {
    const text = this.#texts.get(document);
    if (text === undefined) throw new Error(`Texte juridique absent : ${document}`);
    return text;
  }
}
