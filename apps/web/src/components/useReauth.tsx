import { useId, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { reauthenticate } from "../api/identity";
import { ErrorMessage } from "./ErrorMessage";

/**
 * Action sensible (R7) : si le serveur exige une réauthentification, on demande le mot de passe
 * (et le code TOTP s'il est activé), puis on relance l'action une seule fois.
 */
export function useReauth(withTotp: boolean): {
  run: (action: () => Promise<void>) => Promise<void>;
  prompt: ReactNode;
} {
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<unknown>(null);
  const passwordId = useId();
  const totpId = useId();

  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "identity.reauthentication-required") {
        setPending(() => action);
        return;
      }
      throw caught;
    }
  };

  const prompt =
    pending === null ? null : (
      <form
        className="reauth"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            try {
              await reauthenticate(password, withTotp ? totp : undefined);
              await pending();
              setPending(null);
              setPassword("");
              setTotp("");
              setError(null);
            } catch (caught) {
              setError(caught);
            }
          })();
        }}
      >
        <p>Pour cette action importante, confirme d'abord ton mot de passe.</p>
        <label htmlFor={passwordId}>Mot de passe</label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
        />
        {withTotp && (
          <>
            <label htmlFor={totpId}>Code de l'application d'authentification</label>
            <input
              id={totpId}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totp}
              onChange={(event) => {
                setTotp(event.target.value);
              }}
            />
          </>
        )}
        <ErrorMessage error={error} />
        <button type="submit" className="button">
          Confirmer
        </button>
      </form>
    );

  return { run, prompt };
}
