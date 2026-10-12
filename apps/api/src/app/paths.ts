import { fileURLToPath } from "node:url";

/** Textes juridiques (docs/juridique), lus tels quels ; copiés dans l'image au lot L7. */
export const DEFAULT_LEGAL_DIR = fileURLToPath(new URL("../../../../docs/juridique", import.meta.url));
/** Liste des mots de passe courants refusés (R8). */
export const COMMON_PASSWORDS_FILE = fileURLToPath(
  new URL("../../data/common-passwords.txt", import.meta.url),
);
/** Référentiel de compétences validé par le tuteur (Q4), chargé en seed au lot L2. */
export const REFERENTIAL_FILE = fileURLToPath(
  new URL("../../../../docs/domaine/referentiel-competences.md", import.meta.url),
);
/** Fichiers importés en développement (ignoré par Git) ; en production, le volume `ardoiz_files`. */
export const DEFAULT_MEDIA_DIR = fileURLToPath(new URL("../../../../var/media", import.meta.url));
