import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { fetchLegal, fetchSessions, revokeSession, type LegalDocument } from "../api/identity";
import { homePathFor, useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { useLogout } from "../layout/AppLayout";
import { Markdown } from "../markdown/Markdown";
import { Button, ButtonLink, Card, PageHeader, Pill } from "../ui";
import { shortDateTime } from "../ui/format";
import { Check, LogOut, Monitor, Smartphone } from "../ui/icons";
import { describeUserAgent } from "../ui/userAgent";

/** Accueil : chacun est envoyé vers son espace ; un visiteur, vers la connexion. */
export function HomePage() {
  const me = useMe();
  if (me.isPending) return <p role="status">Chargement…</p>;
  if (me.data === null || me.data === undefined) return <Navigate to="/connexion" replace />;
  return <Navigate to={homePathFor(me.data)} replace />;
}

const MOBILE = /Android|iPhone|iPad|Mobile/;

/**
 * Mon compte : sécurité du compte et appareils connectés, chacun nommé lisiblement (« Firefox sur
 * Linux », L8 correction 4), avec la déconnexion d'un appareil (R8). L'élève est tutoyé, l'adulte
 * vouvoyé (charte §7).
 */
export function AccountPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions });
  const revoke = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      for (const id of ids) await revokeSession(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const learner = me.data?.kind === "learner";
  const others = (sessions.data?.sessions ?? []).filter((session) => !session.current);

  return (
    <div className="page narrow">
      <PageHeader title="Mon compte" />
      <div className="stack">
        <Card aria-labelledby="securite">
          <h2 id="securite">Sécurité</h2>
          <ul className="rows">
            <li>
              <div className="row-main">
                <p className="row-title">Mot de passe</p>
                <p className="row-meta">
                  {learner
                    ? "Pour en changer, demande à ton parent ou à ton tuteur."
                    : "Pour en changer, recevez un lien par e-mail."}
                </p>
              </div>
              {!learner && (
                <ButtonLink to="/mot-de-passe-oublie" variant="secondary">
                  Changer
                </ButtonLink>
              )}
            </li>
            {!learner && me.data !== null && me.data !== undefined && (
              <li>
                <div className="row-main">
                  <p className="row-title">Double authentification</p>
                  <p className="row-meta">Code à 6 chiffres de votre application d'authentification.</p>
                </div>
                {me.data.mfaEnrolled ? (
                  <Pill tone="done" icon={Check}>
                    Activée
                  </Pill>
                ) : (
                  <ButtonLink to="/double-authentification/activer" variant="secondary">
                    Activer (recommandé)
                  </ButtonLink>
                )}
              </li>
            )}
          </ul>
        </Card>

        <Card aria-labelledby="appareils">
          <h2 id="appareils">{learner ? "Où tu es connecté" : "Appareils connectés"}</h2>
          <ErrorMessage error={sessions.error ?? revoke.error} />
          {sessions.isPending && <p role="status">Chargement…</p>}
          <ul className="rows">
            {sessions.data?.sessions.map((session) => {
              const name = describeUserAgent(session.userAgent);
              return (
                <li key={session.id}>
                  <div className="row-main">
                    <p className="row-title">{name}</p>
                    <p className="row-meta">Connecté le {shortDateTime(session.createdAt)}</p>
                  </div>
                  {session.current ? (
                    <Pill tone="info" icon={MOBILE.test(session.userAgent ?? "") ? Smartphone : Monitor}>
                      Cet appareil
                    </Pill>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={revoke.isPending}
                      aria-label={`Déconnecter ${name}, connecté le ${shortDateTime(session.createdAt)}`}
                      onClick={() => {
                        revoke.mutate([session.id]);
                      }}
                    >
                      Déconnecter
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {others.length > 1 && (
            <Button
              variant="quiet"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(others.map((session) => session.id));
              }}
            >
              Déconnecter tous les autres appareils
            </Button>
          )}
        </Card>

        {learner && (
          <Card aria-labelledby="mes-donnees">
            <h2 id="mes-donnees">Mes données</h2>
            <p>
              <Link to="/mes-donnees">Ce qu'Ardoiz sait de toi</Link>
            </p>
          </Card>
        )}
        <div>
          <Button variant="secondary" icon={LogOut} onClick={logout.run}>
            Me déconnecter
          </Button>
          <ErrorMessage error={logout.error} />
        </div>
      </div>
    </div>
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
    <div className="page narrow">
      <Card as="article" className="legal">
        {/* Un seul titre (verdict L8, S-8) : celui du document une fois chargé, le nom de la page avant. */}
        {text.data === undefined ? (
          <h1>{TITLES[document]}</h1>
        ) : (
          <Markdown source={text.data.markdown} pageTitle={TITLES[document]} />
        )}
        {text.isPending && <p role="status">Chargement…</p>}
        <ErrorMessage error={text.error} />
      </Card>
    </div>
  );
}
