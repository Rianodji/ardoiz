import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { completePasswordReset, requestPasswordReset } from "../api/identity";
import { ErrorMessage } from "../components/ErrorMessage";
import { tokenFromHash } from "./InvitationPage";

/** Mot de passe oublié (adultes) : même réponse que le compte existe ou non (R8). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const emailId = useId();
  const request = useMutation({ mutationFn: () => requestPasswordReset(email) });
  return (
    <section className="card narrow">
      <h1>Mot de passe oublié</h1>
      {request.isSuccess ? (
        <p role="status">
          Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Le lien est valable 30
          minutes.
        </p>
      ) : (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <label htmlFor={emailId}>Adresse e-mail</label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            required
          />
          <ErrorMessage error={request.error} />
          <button type="submit" className="button" disabled={request.isPending}>
            Recevoir un lien
          </button>
        </form>
      )}
      <p className="hint">
        Les élèves demandent à leur parent ou à leur tuteur de changer leur mot de passe.
      </p>
    </section>
  );
}

export function NewPasswordPage() {
  const token = tokenFromHash(useLocation().hash);
  const [password, setPassword] = useState("");
  const passwordId = useId();
  const complete = useMutation({ mutationFn: () => completePasswordReset(token, password) });
  return (
    <section className="card narrow">
      <h1>Nouveau mot de passe</h1>
      {complete.isSuccess ? (
        <p role="status">
          C'est fait. Toutes vos sessions ont été fermées. <Link to="/connexion">Se connecter</Link>
        </p>
      ) : (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            complete.mutate();
          }}
        >
          <label htmlFor={passwordId}>Nouveau mot de passe (12 caractères au moins)</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
          />
          <ErrorMessage error={complete.error} />
          <button type="submit" className="button" disabled={complete.isPending}>
            Enregistrer
          </button>
        </form>
      )}
    </section>
  );
}
