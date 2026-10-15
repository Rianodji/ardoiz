import { messageFor, type Audience } from "../api/messages";
import { useMe } from "../auth/session";

/**
 * Message d'erreur annoncé aux lecteurs d'écran ; jamais le texte brut du serveur. L'élève est tutoyé,
 * l'adulte vouvoyé (charte §7) : la personne connectée le décide, sauf si la page le précise.
 */
export function ErrorMessage({ error, audience }: { readonly error: unknown; readonly audience?: Audience }) {
  const me = useMe();
  if (error === null || error === undefined) return null;
  const kind = me.data?.kind;
  const who = audience ?? (kind === "tutor" || kind === "guardian" ? "adult" : "learner");
  return (
    <p role="alert" className="error">
      {messageFor(error, who)}
    </p>
  );
}
