import { useId, useState, type SubmitEvent } from "react";

type Mode = "learner" | "adult";

/**
 * Page de connexion FACTICE du lot L0 : elle fixe la mise en page et l'accessibilité des deux modes
 * (ADR-0003 : code d'espace + pseudo pour l'élève, e-mail pour l'adulte). La connexion réelle
 * arrive au lot L1 ; ici, rien n'est envoyé au serveur.
 */
export function LoginPage() {
  const [mode, setMode] = useState<Mode>("learner");
  const [notice, setNotice] = useState<string | null>(null);
  const formId = useId();

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("La connexion n'est pas encore ouverte. Elle arrive très bientôt !");
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
          }}
        >
          Je suis élève
        </button>
        <button
          type="button"
          aria-pressed={mode === "adult"}
          onClick={() => {
            setMode("adult");
          }}
        >
          Je suis parent ou tuteur
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        aria-describedby={notice === null ? undefined : `${formId}-notice`}
      >
        {mode === "learner" ? (
          <>
            <label htmlFor={`${formId}-space`}>Code de ton espace</label>
            <input id={`${formId}-space`} name="spaceCode" autoComplete="organization" required />
            <label htmlFor={`${formId}-username`}>Ton pseudo</label>
            <input id={`${formId}-username`} name="username" autoComplete="username" required />
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
        <button type="submit" className="button">
          Me connecter
        </button>
      </form>

      {notice !== null && (
        <p id={`${formId}-notice`} role="status" className="notice">
          {notice}
        </p>
      )}
    </section>
  );
}
