import { fileURLToPath } from "node:url";

/** Textes juridiques (docs/juridique), lus tels quels ; copiés dans l'image au lot L7. */
export const DEFAULT_LEGAL_DIR = fileURLToPath(new URL("../../../../docs/juridique", import.meta.url));
/** Liste des mots de passe courants refusés (R8). */
export const COMMON_PASSWORDS_FILE = fileURLToPath(
  new URL("../../data/common-passwords.txt", import.meta.url),
);
