import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { logout } from "../api/identity";
import { ME_QUERY, useMe } from "../auth/session";

const SPACE_LABELS = { tutor: "Espace tuteur", guardian: "Espace famille", learner: "Mon espace" } as const;

/**
 * Mise en page commune (WCAG 2.2 AA) : lien d'évitement, en-tête, contenu, pied de page avec les
 * textes juridiques. Trois espaces visuellement distincts (attribut data-space) : élève, parent, tuteur.
 */
export function AppLayout() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const kind = me.data?.kind;

  const onLogout = () => {
    void (async () => {
      await logout();
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: ME_QUERY });
      await navigate("/connexion");
    })();
  };

  return (
    <div className="app" data-space={kind ?? "public"}>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="app-header">
        <Link to="/" className="brand" aria-label="Ardoiz, accueil">
          <span aria-hidden="true" className="brand-mark">
            ✎
          </span>
          Ardoiz
          {kind !== undefined && <span className="space-label">{SPACE_LABELS[kind]}</span>}
        </Link>
        <nav aria-label="Navigation principale">
          {kind === undefined && <NavLink to="/connexion">Se connecter</NavLink>}
          {kind === "tutor" && (
            <>
              <NavLink to="/tuteur/programme">Programme</NavLink>
              <NavLink to="/tuteur/referentiel">Compétences</NavLink>
              <NavLink to="/tuteur/groupes">Groupes</NavLink>
              <NavLink to="/tuteur/familles">Familles</NavLink>
              <NavLink to="/tuteur/journal">Journal d'audit</NavLink>
            </>
          )}
          {kind === "guardian" && <NavLink to="/famille">Mes enfants</NavLink>}
          {kind === "learner" && <NavLink to="/eleve">Accueil</NavLink>}
          {kind !== undefined && (
            <>
              <NavLink to="/compte">Mon compte</NavLink>
              <button type="button" className="link-button on-dark" onClick={onLogout}>
                Me déconnecter
              </button>
            </>
          )}
        </nav>
      </header>
      <main id="contenu" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        <p>
          Ardoiz · tutorat à distance · <Link to="/mentions-legales">Mentions légales</Link> ·{" "}
          <Link to="/confidentialite">Confidentialité</Link>
        </p>
      </footer>
    </div>
  );
}
