import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { acceptInvitation, inspectInvitation } from "../api/identity";
import { ME_QUERY } from "../auth/session";
import { ConsentForm } from "../components/ConsentForm";
import { ErrorMessage } from "../components/ErrorMessage";

/** Le jeton est dans le fragment (#jeton=…) : le navigateur ne l'envoie jamais au serveur dans l'URL (R21). */
export function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get("jeton") ?? "";
}

/** Acceptation d'une invitation : consentement parental versionné, puis création ou confirmation du compte (R1, R16). */
export function InvitationPage() {
  const token = tokenFromHash(useLocation().hash);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const nameId = useId();
  const passwordId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invitation = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => inspectInvitation(token),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: (consent: Parameters<typeof acceptInvitation>[0]["consent"]) =>
      acceptInvitation(
        invitation.data?.accountExists === true
          ? { token, password, consent }
          : { token, password, displayName, consent },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY });
      await navigate("/famille");
    },
  });

  if (invitation.isPending) return <p role="status">Vérification de l'invitation…</p>;
  if (invitation.isError) {
    return (
      <section className="card narrow">
        <h1>Invitation introuvable</h1>
        <p>
          Ce lien n'est plus valable : il a déjà servi, ou il a dépassé 72 heures. Demandez une nouvelle
          invitation au tuteur.
        </p>
      </section>
    );
  }
  const view = invitation.data;
  return (
    <section className="card narrow wide">
      <h1>Rejoindre Ardoiz</h1>
      <p>
        Invitation pour <strong>{view.email}</strong>
        {view.learnerFirstName === null ? "." : `, pour suivre ${view.learnerFirstName}.`}
      </p>
      <ConsentForm
        pending={accept.isPending}
        onSubmit={(consent) => {
          accept.mutate(consent);
        }}
      >
        <fieldset className="form-stack">
          <legend>{view.accountExists ? "Confirmez votre compte" : "Créez votre compte"}</legend>
          {!view.accountExists && (
            <>
              <label htmlFor={nameId}>Votre nom (affiché au tuteur et à l'autre parent)</label>
              <input
                id={nameId}
                autoComplete="name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
                required
              />
            </>
          )}
          <label htmlFor={passwordId}>
            {view.accountExists
              ? "Votre mot de passe"
              : "Choisissez un mot de passe (12 caractères au moins)"}
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete={view.accountExists ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
          />
          <ErrorMessage error={accept.error} />
        </fieldset>
      </ConsentForm>
    </section>
  );
}
