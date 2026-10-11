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
  "http.rate-limited": "Trop d'essais d'un coup. Attends un peu, puis réessaie.",
};

const GENERIC = "Un problème est survenu. Réessaie dans un moment ; si ça continue, préviens ton tuteur.";

export function messageFor(error: unknown): string {
  return error instanceof ApiError ? (MESSAGES[error.code] ?? GENERIC) : GENERIC;
}
