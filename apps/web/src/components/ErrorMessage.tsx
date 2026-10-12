import { messageFor } from "../api/messages";

/** Message d'erreur annoncé aux lecteurs d'écran ; jamais le texte brut du serveur. */
export function ErrorMessage({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  return (
    <p role="alert" className="error">
      {messageFor(error)}
    </p>
  );
}
