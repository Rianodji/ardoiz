import { Link, NavLink, Outlet } from "react-router";

/** Mise en page commune : lien d'évitement, en-tête, contenu principal, pied de page (WCAG 2.2 AA). */
export function AppLayout() {
  return (
    <>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="app-header">
        <Link to="/" className="brand" aria-label="Ardoiz, accueil">
          <span aria-hidden="true" className="brand-mark">
            ✎
          </span>
          Ardoiz
        </Link>
        <nav aria-label="Navigation principale">
          <NavLink to="/connexion">Se connecter</NavLink>
        </nav>
      </header>
      <main id="contenu" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        <p>Ardoiz · tutorat à distance</p>
      </footer>
    </>
  );
}
