import { useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent, type SubmitEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { loginAdult, loginLearner } from "../api/identity";
import { homePathFor, ME_QUERY, useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { Button, Field, Icon, Logo } from "../ui";
import { BookText, Users } from "../ui/icons";

type Mode = "learner" | "adult";

/** Champ de mot de passe avec un bouton « Afficher » : un enfant vérifie ce qu'il a tapé. */
export function PasswordField({
  label,
  autoComplete,
  name = "password",
  value,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly autoComplete: "current-password" | "new-password";
  readonly name?: string;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <div className="input-with-button">
          <input
            {...control}
            name={name}
            type={visible ? "text" : "password"}
            autoComplete={autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            required
            {...(value === undefined ? {} : { value })}
            {...(onChange === undefined
              ? {}
              : {
                  onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    onChange(event.target.value);
                  },
                })}
          />
          <button
            type="button"
            className="reveal"
            aria-label={`${visible ? "Masquer" : "Afficher"} le mot de passe`}
            aria-controls={control.id}
            onClick={() => {
              setVisible(!visible);
            }}
          >
            {visible ? "Masquer" : "Afficher"}
          </button>
        </div>
      )}
    </Field>
  );
}

/**
 * Connexion (ADR-0003) : l'élève avec le code de son espace, son pseudo et son mot de passe ;
 * l'adulte avec son e-mail. Le message d'erreur est le même quelle que soit la cause (R8).
 * Page plein écran, sans menu (maquette « Connexion »).
 */
export function LoginPage() {
  const me = useMe();
  const [mode, setMode] = useState<Mode>("learner");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Déjà connecté : chacun retourne dans son espace (L8, correction 1 : jamais d'ancien menu ici).
  if (me.data !== null && me.data !== undefined) return <Navigate to={homePathFor(me.data)} replace />;

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
  const choose = (next: Mode) => {
    setMode(next);
    setError(null);
  };
  const learner = mode === "learner";

  return (
    <div className="login">
      <div className="login-aside">
        <p className="brand">
          <Logo />
          Ardoiz
        </p>
        <div className="login-pitch">
          <p>Ton cahier, tes cours et tes séances, au même endroit.</p>
          <p>Retrouve ce que ton tuteur t'a préparé, rends tes devoirs et regarde tes progrès.</p>
        </div>
        <p>
          <Link to="/mentions-legales">Mentions légales</Link> ·{" "}
          <Link to="/confidentialite">Confidentialité</Link>
        </p>
      </div>
      <div className="login-form">
        <div>
          <h1>Se connecter</h1>
          <p className="label" id="qui">
            Qui es-tu ?
          </p>
          <div role="group" aria-labelledby="qui" className="who">
            <button
              type="button"
              aria-pressed={learner}
              onClick={() => {
                choose("learner");
              }}
            >
              <Icon icon={BookText} />
              Je suis élève
            </button>
            <button
              type="button"
              aria-pressed={!learner}
              onClick={() => {
                choose("adult");
              }}
            >
              <Icon icon={Users} />
              Je suis un adulte
            </button>
          </div>
          <form onSubmit={onSubmit} noValidate className="form-stack" key={mode}>
            {learner ? (
              <>
                <Field label="Code de ton espace">
                  {(control) => (
                    <input
                      {...control}
                      name="spaceCode"
                      placeholder="donné par ton tuteur"
                      autoComplete="organization"
                      autoCapitalize="none"
                      required
                    />
                  )}
                </Field>
                <Field label="Ton pseudo">
                  {(control) => (
                    <input
                      {...control}
                      name="username"
                      autoComplete="username"
                      autoCapitalize="none"
                      required
                    />
                  )}
                </Field>
              </>
            ) : (
              <Field label="Adresse e-mail">
                {(control) => <input {...control} name="email" type="email" autoComplete="email" required />}
              </Field>
            )}
            <PasswordField
              label={learner ? "Ton mot de passe" : "Mot de passe"}
              autoComplete="current-password"
            />
            <ErrorMessage error={error} audience={learner ? "learner" : "adult"} />
            <Button type="submit" className="btn-wide" disabled={pending}>
              {pending ? "Connexion…" : "Entrer dans Ardoiz"}
            </Button>
          </form>
          <div className="card compact login-help">
            {learner ? (
              <p>
                Mot de passe oublié ? Demande à ton parent ou à ton tuteur : il peut t'en donner un nouveau.
              </p>
            ) : (
              <p>
                <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link> Vous recevrez un lien par e-mail.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
