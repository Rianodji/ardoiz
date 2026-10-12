import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { fetchLegal, fetchSessions, revokeSession, type LegalDocument } from "../api/identity";
import { homePathFor, useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { Markdown } from "../markdown/Markdown";

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

/** Accueil : chacun est envoyé vers son espace ; un visiteur, vers la connexion. */
export function HomePage() {
  const me = useMe();
  if (me.isPending) return <p role="status">Chargement…</p>;
  if (me.data === null || me.data === undefined) {
    return (
      <section className="card">
        <h1>Bienvenue sur Ardoiz</h1>
        <p>Ici, tu retrouves tes cours, tes séances et tes devoirs.</p>
        <p>
          <Link className="button" to="/connexion">
            Se connecter
          </Link>
        </p>
      </section>
    );
  }
  return <Navigate to={homePathFor(me.data)} replace />;
}

/** Mon compte : sessions ouvertes, révocation (R8). */
export function AccountPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions });
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  return (
    <section className="card">
      <h1>Mon compte</h1>
      {me.data !== null && me.data !== undefined && me.data.kind !== "learner" && !me.data.mfaEnrolled && (
        <p>
          <Link to="/double-authentification/activer">Activer la double authentification</Link> (recommandé).
        </p>
      )}
      <h2>Mes sessions ouvertes</h2>
      <ErrorMessage error={sessions.error ?? revoke.error} />
      <ul className="plain">
        {sessions.data?.sessions.map((session) => (
          <li key={session.id}>
            Ouverte le {dateTime.format(new Date(session.createdAt))}
            {session.userAgent === null ? "" : ` · ${session.userAgent.slice(0, 60)}`}
            {session.current ? (
              <strong> · cette session</strong>
            ) : (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  revoke.mutate(session.id);
                }}
              >
                Fermer cette session
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const TITLES: Readonly<Record<LegalDocument, string>> = {
  "mentions-legales": "Mentions légales",
  confidentialite: "Politique de confidentialité",
  "confidentialite-eleve": "Mes données",
  consentement: "Consentement parental",
};

/** Texte juridique de docs/juridique, affiché sans modification (rendu en composants, R4). */
export function LegalPage({ document }: { readonly document: LegalDocument }) {
  const text = useQuery({ queryKey: ["legal", document], queryFn: () => fetchLegal(document) });
  return (
    <section className="card legal">
      <h1>{TITLES[document]}</h1>
      {text.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={text.error} />
      {text.data !== undefined && <Markdown source={text.data.markdown} />}
    </section>
  );
}

/** Espace élève (L1) : accueil ; les cours arrivent au lot L2. */
export function LearnerHomePage() {
  const me = useMe();
  return (
    <section className="card">
      <h1>Bonjour {me.data?.name ?? ""} !</h1>
      <p>Tes cours, tes séances et tes devoirs apparaîtront ici dès que ton tuteur les aura préparés.</p>
      <p>
        <Link to="/mes-donnees">Ce qu'Ardoiz sait de toi</Link>
      </p>
    </section>
  );
}
