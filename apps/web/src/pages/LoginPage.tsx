import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router";
import { loginAdult, loginLearner } from "../api/identity";
import { ME_QUERY } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";

type Mode = "learner" | "adult";

/**
 * Connexion (ADR-0003) : l'élève avec le code de son espace, son pseudo et son mot de passe ;
 * l'adulte avec son e-mail. Le message d'erreur est le même quelle que soit la cause (R8).
 */
export function LoginPage() {
  const [mode, setMode] = useState<Mode>("learner");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const formId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const result =
          mode === "learner"
            ? await loginLearner(field("spaceCode"), field("username"), field("password"))
            : await loginAdult(field("email"), field("password"));
        await queryClient.invalidateQueries({ queryKey: ME_QUERY });
        if (result.status === "mfa-required") await navigate("/double-authentification");
        else if (result.status === "mfa-enrollment-required")
          await navigate("/double-authentification/activer");
        else await navigate("/");
      } catch (caught) {
        setError(caught);
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <section className="card narrow">
      <h1>Se connecter</h1>
      <div role="group" aria-label="Qui se connecte ?" className="mode-switch">
        <button
          type="button"
          aria-pressed={mode === "learner"}
          onClick={() => {
            setMode("learner");
            setError(null);
          }}
        >
          Je suis élève
        </button>
        <button
          type="button"
          aria-pressed={mode === "adult"}
          onClick={() => {
            setMode("adult");
            setError(null);
          }}
        >
          Je suis parent ou tuteur
        </button>
      </div>

      <form onSubmit={onSubmit} noValidate>
        {mode === "learner" ? (
          <>
            <label htmlFor={`${formId}-space`}>Code de ton espace</label>
            <input
              id={`${formId}-space`}
              name="spaceCode"
              autoComplete="organization"
              required
              autoCapitalize="none"
            />
            <label htmlFor={`${formId}-username`}>Ton pseudo</label>
            <input
              id={`${formId}-username`}
              name="username"
              autoComplete="username"
              required
              autoCapitalize="none"
            />
          </>
        ) : (
          <>
            <label htmlFor={`${formId}-email`}>Adresse e-mail</label>
            <input id={`${formId}-email`} name="email" type="email" autoComplete="email" required />
          </>
        )}
        <label htmlFor={`${formId}-password`}>Mot de passe</label>
        <input
          id={`${formId}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <ErrorMessage error={error} />
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Connexion…" : "Me connecter"}
        </button>
      </form>
      {mode === "learner" ? (
        <p className="hint">Mot de passe oublié ? Demande à ton parent ou à ton tuteur de le changer.</p>
      ) : (
        <p className="hint">
          <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
        </p>
      )}
    </section>
  );
}
