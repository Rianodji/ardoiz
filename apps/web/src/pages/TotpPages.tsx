import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { activateTotp, startTotpEnrollment, verifyTotp } from "../api/identity";
import { ME_QUERY } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { QrCode } from "../components/QrCode";

/** Seconde étape de la connexion : code à 6 chiffres, ou code de secours (R7). */
export function TotpVerifyPage() {
  const [code, setCode] = useState("");
  const inputId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: () => verifyTotp(code.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY });
      await navigate("/");
    },
  });
  return (
    <section className="card narrow">
      <h1>Double authentification</h1>
      <p>
        Ouvre ton application d'authentification et saisis le code à 6 chiffres. Tu peux aussi utiliser un
        code de secours.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          verify.mutate();
        }}
      >
        <label htmlFor={inputId}>Code</label>
        <input
          id={inputId}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          required
        />
        <ErrorMessage error={verify.error} />
        <button type="submit" className="button" disabled={verify.isPending}>
          Valider
        </button>
      </form>
    </section>
  );
}

/** Activation du TOTP : obligatoire pour le tuteur, facultative pour un parent (R7). */
export function TotpEnrollPage() {
  const [code, setCode] = useState("");
  const inputId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const start = useMutation({ mutationFn: startTotpEnrollment });
  const activate = useMutation({
    mutationFn: () => activateTotp(code.trim()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY }),
  });

  if (activate.data !== undefined) {
    return (
      <section className="card narrow">
        <h1>Double authentification activée</h1>
        <p>
          Voici tes <strong>codes de secours</strong>. Chacun ne sert qu'une fois, si tu n'as plus ton
          téléphone. Note-les et range-les en lieu sûr : ils ne seront plus jamais affichés.
        </p>
        <ul className="recovery-codes">
          {activate.data.recoveryCodes.map((recovery) => (
            <li key={recovery}>
              <code>{recovery}</code>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigate("/");
          }}
        >
          J'ai noté mes codes, continuer
        </button>
      </section>
    );
  }

  return (
    <section className="card narrow">
      <h1>Activer la double authentification</h1>
      <p>
        Pour protéger les données des élèves, le compte tuteur demande un second code à chaque connexion.
        Installe une application d'authentification (par exemple FreeOTP, Aegis ou Google Authenticator).
      </p>
      {start.data === undefined ? (
        <>
          <ErrorMessage error={start.error} />
          <button
            type="button"
            className="button"
            disabled={start.isPending}
            onClick={() => {
              start.mutate();
            }}
          >
            Commencer
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            activate.mutate();
          }}
        >
          <p>Avec l'application, scanne ce QR code :</p>
          <QrCode
            value={start.data.otpauthUri}
            label="QR code à scanner avec l'application d'authentification"
          />
          <p>
            Sans appareil photo, ajoute un compte avec cette clé (ou touche le lien depuis ton téléphone) :
          </p>
          <p className="secret">
            <code>{start.data.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          </p>
          <p>
            <a href={start.data.otpauthUri}>Ouvrir dans l'application d'authentification</a>
          </p>
          <label htmlFor={inputId}>Code à 6 chiffres affiché par l'application</label>
          <input
            id={inputId}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            required
          />
          <ErrorMessage error={activate.error} />
          <button type="submit" className="button" disabled={activate.isPending}>
            Activer
          </button>
        </form>
      )}
    </section>
  );
}
