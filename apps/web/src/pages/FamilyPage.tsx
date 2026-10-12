import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  createLearner,
  fetchMyLearners,
  inviteCoGuardian,
  resetLearnerPassword,
  withdrawConsent,
} from "../api/identity";
import { useMe } from "../auth/session";
import { ConsentForm } from "../components/ConsentForm";
import { ErrorMessage } from "../components/ErrorMessage";
import { useReauth } from "../components/useReauth";
import { PublishedResults } from "./AssessmentPages";
import { LearnerProgrammeView } from "./LessonPages";

const LEVELS = ["6e", "5e", "4e", "3e"] as const;
const LEARNERS_QUERY = ["learners"] as const;

/** Espace famille du parent : ses enfants, la création d'un compte enfant, le co-parent, le retrait de l'accord. */
export function FamilyPage() {
  const me = useMe();
  const learners = useQuery({ queryKey: LEARNERS_QUERY, queryFn: fetchMyLearners });
  const reauth = useReauth(me.data?.mfaEnrolled ?? false);

  return (
    <div className="stack">
      <section className="card">
        <h1>Mes enfants</h1>
        {learners.isPending && <p role="status">Chargement…</p>}
        <ErrorMessage error={learners.error} />
        {learners.data?.learners.length === 0 && <p>Tu n'as pas encore créé de compte pour ton enfant.</p>}
        <ul className="learner-list">
          {learners.data?.learners.map((learner) => (
            <li key={learner.id}>
              <LearnerCard learner={learner} runSensitive={reauth.run} />
            </li>
          ))}
        </ul>
        {reauth.prompt}
      </section>
      <NewLearner />
    </div>
  );
}

function LearnerCard({
  learner,
  runSensitive,
}: {
  readonly learner: {
    id: string;
    firstName: string;
    username: string;
    schoolLevel: string;
    status: string;
    guardians: ReadonlyArray<{ displayName: string }>;
  };
  readonly runSensitive: (action: () => Promise<void>) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const emailId = useId();
  const passwordId = useId();
  const refresh = () => queryClient.invalidateQueries({ queryKey: LEARNERS_QUERY });
  const act = (work: () => Promise<void>, done: string) => {
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        await work();
        setMessage(done);
        await refresh();
      } catch (caught) {
        setError(caught);
      }
    })();
  };

  return (
    <article className="learner">
      <h2>
        {learner.firstName} <span className="muted">({learner.schoolLevel})</span>
      </h2>
      <p>
        Pseudo de connexion : <code>{learner.username}</code>
        {learner.status === "disabled" && <strong> · compte désactivé</strong>}
      </p>
      <p>Parents liés : {learner.guardians.map((guardian) => guardian.displayName).join(", ")}</p>
      <details>
        <summary>Ses cours débloqués</summary>
        <LearnerProgrammeView
          learnerId={learner.id}
          emptyText="Aucun cours n'est encore ouvert pour cet enfant."
        />
      </details>
      <details>
        <summary>Ses résultats publiés</summary>
        <PublishedResults learnerId={learner.id} />
      </details>
      {learner.status === "active" && (
        <>
          <details>
            <summary>Inviter l'autre parent</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                act(() => inviteCoGuardian(learner.id, email).then(() => undefined), "Invitation envoyée.");
              }}
            >
              <label htmlFor={emailId}>Son adresse e-mail</label>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                required
              />
              <button type="submit" className="button">
                Envoyer l'invitation
              </button>
            </form>
          </details>
          <details>
            <summary>Changer son mot de passe</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                act(
                  () => runSensitive(() => resetLearnerPassword(learner.id, password).then(() => undefined)),
                  "Mot de passe changé.",
                );
              }}
            >
              <label htmlFor={passwordId}>Nouveau mot de passe (8 caractères au moins)</label>
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
              <button type="submit" className="button">
                Changer le mot de passe
              </button>
            </form>
          </details>
          <details>
            <summary>Retirer mon accord</summary>
            <p>
              Le compte de {learner.firstName} sera désactivé tout de suite, et ses données supprimées sous 30
              jours.
            </p>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                act(
                  () => withdrawConsent(learner.id).then(() => undefined),
                  "Accord retiré : le compte est désactivé.",
                );
              }}
            >
              Retirer mon accord pour {learner.firstName}
            </button>
          </details>
        </>
      )}
      {message !== null && <p role="status">{message}</p>}
      <ErrorMessage error={error} />
    </article>
  );
}

function NewLearner() {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [schoolLevel, setSchoolLevel] = useState<string>("6e");
  const [password, setPassword] = useState("");
  const ids = { first: useId(), user: useId(), level: useId(), password: useId() };
  const create = useMutation({
    mutationFn: (consent: Parameters<typeof createLearner>[0]["consent"]) =>
      createLearner({ firstName, username, schoolLevel, password, consent }),
    onSuccess: async () => {
      setFirstName("");
      setUsername("");
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: LEARNERS_QUERY });
    },
  });

  return (
    <section className="card">
      <h2>Créer le compte d'un enfant</h2>
      <p className="hint">
        Seulement le prénom, un pseudo et la classe : Ardoiz ne demande ni nom de famille, ni date de
        naissance, ni photo.
      </p>
      <ConsentForm
        pending={create.isPending}
        onSubmit={(consent) => {
          create.mutate(consent);
        }}
      >
        <fieldset>
          <legend>Ton enfant</legend>
          <label htmlFor={ids.first}>Prénom</label>
          <input
            id={ids.first}
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
            required
          />
          <label htmlFor={ids.user}>Pseudo de connexion (par exemple « lina.ardoiz »)</label>
          <input
            id={ids.user}
            autoCapitalize="none"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            required
          />
          <label htmlFor={ids.level}>Classe</label>
          <select
            id={ids.level}
            value={schoolLevel}
            onChange={(event) => {
              setSchoolLevel(event.target.value);
            }}
          >
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <label htmlFor={ids.password}>Son mot de passe (8 caractères au moins)</label>
          <input
            id={ids.password}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
          />
          <ErrorMessage error={create.error} />
          {create.isSuccess && (
            <p role="status">Compte créé. Ton enfant peut se connecter avec son pseudo.</p>
          )}
        </fieldset>
      </ConsentForm>
    </section>
  );
}
