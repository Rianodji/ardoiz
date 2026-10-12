import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  fetchAudit,
  fetchFamilies,
  inviteGuardian,
  resetLearnerPassword,
  revokeGuardianship,
} from "../api/identity";
import { ErrorMessage } from "../components/ErrorMessage";
import { useReauth } from "../components/useReauth";

const FAMILIES_QUERY = ["families"] as const;

/** Gestion des familles par le tuteur : inviter, voir tous les liens parentaux (H1), les révoquer. */
export function TutorFamiliesPage() {
  const queryClient = useQueryClient();
  const families = useQuery({ queryKey: FAMILIES_QUERY, queryFn: fetchFamilies });
  const reauth = useReauth(true);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const emailId = useId();
  const invite = useMutation({
    mutationFn: () => inviteGuardian(email),
    onSuccess: () => {
      setEmail("");
    },
  });
  const act = (work: () => Promise<void>, done: string) => {
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        await reauth.run(work);
        setMessage(done);
        await queryClient.invalidateQueries({ queryKey: FAMILIES_QUERY });
      } catch (caught) {
        setError(caught);
      }
    })();
  };

  return (
    <div className="stack">
      <section className="card">
        <h1>Familles</h1>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          <label htmlFor={emailId}>Inviter un parent (adresse e-mail)</label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            required
          />
          <button type="submit" className="button" disabled={invite.isPending}>
            Envoyer l'invitation
          </button>
        </form>
        <ErrorMessage error={invite.error} />
        {invite.isSuccess && <p role="status">Invitation envoyée (valable 72 heures).</p>}
      </section>

      <section className="card">
        <h2>Élèves et liens parentaux</h2>
        {families.isPending && <p role="status">Chargement…</p>}
        <ErrorMessage error={families.error} />
        {reauth.prompt}
        {message !== null && <p role="status">{message}</p>}
        <ErrorMessage error={error} />
        <table>
          <thead>
            <tr>
              <th scope="col">Élève</th>
              <th scope="col">Classe</th>
              <th scope="col">Parents liés</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {families.data?.learners.map((learner) => (
              <tr key={learner.id}>
                <td>
                  {learner.firstName} <code>{learner.username}</code>
                  {learner.status === "disabled" && <strong> (désactivé)</strong>}
                </td>
                <td>{learner.schoolLevel}</td>
                <td>
                  <ul className="plain">
                    {learner.guardians.map((guardian) => (
                      <li key={guardian.guardianshipId}>
                        {guardian.displayName}{" "}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            act(
                              () => revokeGuardianship(guardian.guardianshipId).then(() => undefined),
                              `Lien de ${guardian.displayName} avec ${learner.firstName} révoqué.`,
                            );
                          }}
                        >
                          Révoquer ce lien
                        </button>
                      </li>
                    ))}
                  </ul>
                </td>
                <td>
                  <ResetPassword
                    firstName={learner.firstName}
                    onReset={(password) => {
                      act(
                        () => resetLearnerPassword(learner.id, password).then(() => undefined),
                        `Mot de passe de ${learner.firstName} changé.`,
                      );
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Parents</h3>
        <ul>
          {families.data?.guardians.map((guardian) => (
            <li key={guardian.id}>
              {guardian.displayName} — {guardian.email}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ResetPassword({
  firstName,
  onReset,
}: {
  readonly firstName: string;
  readonly onReset: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const id = useId();
  return (
    <details>
      <summary>Nouveau mot de passe</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onReset(password);
          setPassword("");
        }}
      >
        <label htmlFor={id}>Mot de passe de {firstName}</label>
        <input
          id={id}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
        />
        <button type="submit" className="button">
          Enregistrer
        </button>
      </form>
    </details>
  );
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  "identity.tutor-login": "Connexion du tuteur",
  "identity.guardianship-established": "Lien parental établi",
  "identity.guardianship-revoked": "Lien parental révoqué",
  "identity.consent-given": "Consentement donné",
  "identity.consent-withdrawn": "Consentement retiré",
  "identity.invitation-issued": "Invitation envoyée",
  "identity.learner-password-reset": "Mot de passe d'élève changé",
  "identity.password-reset": "Mot de passe réinitialisé",
  "identity.mfa-enabled": "Double authentification activée",
  "identity.recovery-codes-renewed": "Codes de secours renouvelés",
  "identity.space-initialized": "Espace créé",
};

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/Paris",
});

/** Journal d'audit (R12) : actions sensibles et accès refusés, pour le tuteur seulement. */
export function AuditPage() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: fetchAudit });
  return (
    <section className="card wide">
      <h1>Journal d'audit</h1>
      {audit.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={audit.error} />
      <table>
        <thead>
          <tr>
            <th scope="col">Date (heure de Paris)</th>
            <th scope="col">Action</th>
            <th scope="col">Acteur</th>
            <th scope="col">Résultat</th>
          </tr>
        </thead>
        <tbody>
          {audit.data?.entries.map((entry, index) => (
            <tr key={`${entry.occurredAt}-${String(index)}`}>
              <td>{dateTime.format(new Date(entry.occurredAt))}</td>
              <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
              <td>{entry.actorKind}</td>
              <td>
                {entry.outcome === "success" ? "réussi" : entry.outcome === "denied" ? "refusé" : "échoué"}
                {entry.reasonCode === null ? "" : ` (${entry.reasonCode})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
