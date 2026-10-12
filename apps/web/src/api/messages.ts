import { ApiError } from "./client";

/**
 * Messages affichés, écrits pour un enfant de 12 ans : ce qui se passe et quoi faire.
 * Un code inconnu reçoit le message générique, jamais le texte brut du serveur.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  "network.unavailable": "Impossible de joindre Ardoiz. Vérifie ta connexion internet, puis réessaie.",
  "application.not-found": "Cette page n'existe pas, ou tu n'y as pas accès.",
  "application.forbidden": "Tu n'as pas le droit de faire cette action.",
  "http.origin-rejected": "Cette action a été bloquée par sécurité. Recharge la page, puis réessaie.",
  "http.invalid-request": "Certaines informations ne sont pas valides. Vérifie le formulaire.",
  "http.payload-too-large": "C'est trop volumineux pour être envoyé.",
  "http.method-not-allowed": "Cette action n'est pas possible ici.",
  "http.unauthenticated": "Ta session est terminée. Reconnecte-toi pour continuer.",
  "identity.invalid-credentials": "Identifiant ou mot de passe incorrect. Vérifie et réessaie.",
  "identity.invalid-totp":
    "Ce code n'est pas le bon. Saisis le code à 6 chiffres affiché en ce moment dans ton application.",
  "identity.mfa-required": "Saisis d'abord le code de ton application d'authentification.",
  "identity.mfa-enrollment-required": "Active d'abord la double authentification pour continuer.",
  "identity.reauthentication-required": "Pour cette action, confirme d'abord ton mot de passe.",
  "identity.weak-password":
    "Ce mot de passe est trop simple : choisis-en un plus long (12 caractères pour un adulte, 8 pour un élève) et moins courant.",
  "identity.consent-required": "Il faut cocher la case de consentement pour continuer.",
  "identity.email-taken": "Cette adresse e-mail est déjà utilisée par un compte.",
  "identity.username-taken": "Ce pseudo est déjà pris dans cet espace. Choisis-en un autre.",
  "identity.last-guardianship":
    "C'est le dernier parent lié à cet enfant : pour arrêter, utilise plutôt « Retirer mon accord ».",
  "identity.invalid-email": "Cette adresse e-mail n'est pas valide.",
  "identity.invalid-username":
    "Le pseudo doit faire de 3 à 30 caractères : lettres sans accent, chiffres, point, tiret.",
  "identity.invalid-first-name":
    "Le prénom ne doit contenir que des lettres, des espaces, des tirets ou des apostrophes.",
  "identity.invalid-display-name":
    "Le nom ne doit contenir que des lettres, des espaces, des tirets ou des apostrophes.",
  "identity.invalid-school-level": "Choisis une classe dans la liste.",
  "http.too-many-requests": "Trop d'essais d'un coup. Attends un peu, puis réessaie.",
};

const GENERIC = "Un problème est survenu. Réessaie dans un moment ; si ça continue, préviens ton tuteur.";

export function messageFor(error: unknown): string {
  return error instanceof ApiError ? (MESSAGES[error.code] ?? GENERIC) : GENERIC;
}
