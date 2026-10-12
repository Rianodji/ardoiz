import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConsentText } from "../domain/ParentalConsent.js";
import type { ConsentTexts } from "../application/ports.js";

/** Identifiant de la version en vigueur du texte de consentement (docs/juridique/README.md). */
export const CONSENT_VERSION = "consentement-v1";
export const CONSENT_FILE = "consentement-parental-v1.md";

/**
 * Texte de consentement lu tel quel dans docs/juridique (jamais réécrit) ; son empreinte SHA-256
 * est enregistrée avec chaque consentement (R16).
 */
export class FileConsentTexts implements ConsentTexts {
  readonly #current: ConsentText & { readonly markdown: string };

  constructor(legalDir: string) {
    const markdown = readFileSync(join(legalDir, CONSENT_FILE), "utf8");
    this.#current = {
      version: CONSENT_VERSION,
      sha256: createHash("sha256").update(markdown, "utf8").digest("hex"),
      markdown,
    };
  }

  current(): ConsentText {
    return { version: this.#current.version, sha256: this.#current.sha256 };
  }
}
