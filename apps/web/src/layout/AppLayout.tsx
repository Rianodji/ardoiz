import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { fetchGradingQueue } from "../api/assessment";
import { ApiError } from "../api/client";
import { logout } from "../api/identity";
import { fetchSuggestions } from "../api/progress";
import { ME_QUERY, useMe, type Me } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { Icon, Logo, type IconNode } from "../ui";
import { BookText, ClipboardCheck, House, Star, User } from "../ui/icons";
import { FocusContext } from "./focus";

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon?: IconNode;
  /** Autres débuts d'adresse qui appartiennent à cette entrée (un cours ouvert relève de « Mes cours »). */
  readonly also?: readonly string[];
  readonly exact?: boolean;
}

const LEARNER_NAV: readonly NavItem[] = [
  { to: "/eleve", label: "Accueil", icon: House, exact: true },
  { to: "/eleve/cours", label: "Mes cours", icon: BookText, also: ["/cours/"] },
  { to: "/eleve/devoirs", label: "Mes devoirs", icon: ClipboardCheck, also: ["/copie/"] },
  { to: "/eleve/progres", label: "Mes progrès", icon: Star },
];

const GUARDIAN_NAV: readonly NavItem[] = [
  { to: "/famille", label: "Mes enfants", exact: true, also: ["/cours/", "/copie/"] },
  { to: "/famille/suggestions", label: "Suggestions" },
  { to: "/compte", label: "Mon compte" },
];

/** Menu latéral du tuteur, groupé (charte §6) : 9 entrées au lieu des 12 liens d'avant. */
const TUTOR_GROUPS: ReadonlyArray<{ readonly title: string | null; readonly items: readonly NavItem[] }> = [
  { title: null, items: [{ to: "/tuteur", label: "Aujourd'hui", exact: true }] },
  {
    title: "Enseigner",
    items: [
      { to: "/tuteur/programme", label: "Programme", also: ["/tuteur/cours/"] },
      { to: "/tuteur/referentiel", label: "Compétences" },
      { to: "/tuteur/epreuves", label: "Épreuves" },
      { to: "/tuteur/corrections", label: "Corrections" },
      { to: "/tuteur/seances", label: "Séances" },
    ],
  },
  {
    title: "Suivre",
    items: [
      { to: "/tuteur/eleves", label: "Élèves et familles" },
      { to: "/tuteur/progression", label: "Progression" },
      { to: "/tuteur/suggestions", label: "Suggestions" },
    ],
  },
  { title: "Contrôler", items: [{ to: "/tuteur/journal", label: "Journal d'audit" }] },
];

function isActive(item: NavItem, pathname: string): boolean {
  const own = item.exact === true ? pathname === item.to : pathname.startsWith(item.to);
  return own || (item.also ?? []).some((prefix) => pathname.startsWith(prefix));
}

function NavEntry({
  item,
  pathname,
  extra,
}: {
  readonly item: NavItem;
  readonly pathname: string;
  readonly extra?: ReactNode;
}) {
  const active = isActive(item, pathname);
  return (
    <NavLink
      to={item.to}
      end={item.exact === true}
      className={active ? "active" : ""}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-label">
        {item.icon !== undefined && <Icon icon={item.icon} />} {item.label}
      </span>
      {extra}
    </NavLink>
  );
}

/**
 * Déconnexion (L8, correction 1). Avant : `queryClient.clear()` vidait le cache sans prévenir
 * l'observateur de « qui est connecté », qui gardait l'ancien compte ; la page de connexion
 * affichait encore le menu du tuteur, et une page protégée restait ouverte. Désormais, l'état
 * « personne n'est connecté » est écrit explicitement, et toutes les autres données sont oubliées.
 */
function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const run = () => {
    setError(null);
    void (async () => {
      try {
        await logout();
      } catch (caught) {
        // Session déjà terminée côté serveur : il ne reste qu'à oublier l'état local.
        if (!(caught instanceof ApiError && caught.status === 401)) {
          setError(caught);
          return;
        }
      }
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_QUERY[0] });
      queryClient.setQueryData(ME_QUERY, null);
      await navigate("/connexion", { replace: true });
    })();
  };
  return { run, error };
}

function TutorSidebar({
  me,
  pathname,
  onLogout,
}: {
  readonly me: Me;
  readonly pathname: string;
  readonly onLogout: () => void;
}) {
  // Menu replié sur petit écran : il se referme dès que la page change (ouvert « sur » une adresse).
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const enrolled = me.mfaEnrolled;
  // Compteurs de travail (charte §6) : mêmes requêtes que les pages, donc même cache.
  const queue = useQuery({ queryKey: ["grading-queue"], queryFn: fetchGradingQueue, enabled: enrolled });
  const suggestions = useQuery({ queryKey: ["suggestions"], queryFn: fetchSuggestions, enabled: enrolled });
  const toGrade = queue.data?.attempts.filter((attempt) => attempt.status === "submitted").length ?? 0;
  const unread = suggestions.data?.suggestions.filter((entry) => entry.status === "new").length ?? 0;
  const counters: Readonly<Record<string, { count: number; text: string }>> = {
    "/tuteur/corrections": {
      count: toGrade,
      text: `${String(toGrade)} copie${toGrade > 1 ? "s" : ""} à corriger`,
    },
    "/tuteur/suggestions": {
      count: unread,
      text: `${String(unread)} suggestion${unread > 1 ? "s" : ""} non lue${unread > 1 ? "s" : ""}`,
    },
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <Link to="/tuteur" className="brand">
            <Logo />
            Ardoiz
          </Link>
          <button
            type="button"
            className="btn btn-secondary sidebar-toggle dark"
            aria-expanded={open}
            aria-controls="menu-tuteur"
            onClick={() => {
              setOpenOn(open ? null : pathname);
            }}
          >
            Menu
          </button>
        </div>
        <nav id="menu-tuteur" className="sidebar-nav" aria-label="Menu du tuteur" data-open={open}>
          {TUTOR_GROUPS.map((group) => (
            <div key={group.title ?? "accueil"}>
              {group.title !== null && (
                <p className="sidebar-group" id={`groupe-${group.title}`}>
                  {group.title}
                </p>
              )}
              <ul {...(group.title === null ? {} : { "aria-labelledby": `groupe-${group.title}` })}>
                {group.items.map((item) => {
                  const counter = counters[item.to];
                  return (
                    <li key={item.to}>
                      <NavEntry
                        item={item}
                        pathname={pathname}
                        extra={
                          counter !== undefined && counter.count > 0 ? (
                            <>
                              <span className="counter" aria-hidden="true">
                                {counter.count}
                              </span>
                              <span className="visually-hidden">, {counter.text}</span>
                            </>
                          ) : undefined
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <ul className="sidebar-bottom">
            <li>
              <NavEntry item={{ to: "/compte", label: "Mon compte" }} pathname={pathname} />
            </li>
            <li>
              <button type="button" className="nav-button" onClick={onLogout}>
                Me déconnecter
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </aside>
  );
}

function TopBar({
  kind,
  pathname,
  onLogout,
}: {
  readonly kind: "learner" | "guardian" | undefined;
  readonly pathname: string;
  readonly onLogout: () => void;
}) {
  const home = kind === "learner" ? "/eleve" : kind === "guardian" ? "/famille" : "/";
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={home} className="brand">
          <Logo />
          Ardoiz
          {kind === "guardian" && <span className="space-label">Espace famille</span>}
        </Link>
        {kind === undefined && (
          <nav className="main-nav" aria-label="Navigation principale">
            <NavLink to="/connexion">Se connecter</NavLink>
          </nav>
        )}
        {kind === "learner" && (
          <>
            <Link to="/compte" className="nav-secondary learner-account-link">
              <Icon icon={User} /> Moi
            </Link>
            <nav className="main-nav" aria-label="Navigation principale">
              {LEARNER_NAV.map((item) => (
                <NavEntry key={item.to} item={item} pathname={pathname} />
              ))}
              <NavLink
                to="/compte"
                className={pathname === "/compte" ? "nav-secondary active" : "nav-secondary"}
              >
                <span className="nav-label">
                  <Icon icon={User} /> Moi
                </span>
              </NavLink>
            </nav>
          </>
        )}
        {kind === "guardian" && (
          <nav className="main-nav" aria-label="Navigation principale">
            {GUARDIAN_NAV.map((item) => (
              <NavEntry key={item.to} item={item} pathname={pathname} />
            ))}
            <button type="button" className="nav-button" onClick={onLogout}>
              Me déconnecter
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

function Footer({ learner }: { readonly learner: boolean }) {
  return (
    <footer className="app-footer">
      <p>
        Ardoiz · tutorat à distance · <Link to="/mentions-legales">Mentions légales</Link> ·{" "}
        <Link to="/confidentialite">Confidentialité</Link>
        {learner && (
          <>
            {" "}
            · <Link to="/mes-donnees">Ce qu'Ardoiz sait de toi</Link>
          </>
        )}
      </p>
    </footer>
  );
}

/**
 * Mise en page commune (WCAG 2.2 AA) : lien d'évitement, navigation de l'espace, contenu, pied de
 * page juridique. Trois espaces distincts (charte §6) : barre du haut pour l'élève et le parent,
 * menu latéral pour le tuteur ; la connexion a sa propre page plein écran.
 */
export function AppLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  const onLogin = useMatch("/connexion") !== null;
  const [focus, setFocus] = useState(false);
  const logoutAction = useLogout();
  const kind = me.data?.kind;
  const skip = (
    <a className="skip-link" href="#contenu">
      Aller au contenu
    </a>
  );
  const main = (
    <main id="contenu" tabIndex={-1}>
      <ErrorMessage error={logoutAction.error} />
      <Outlet />
    </main>
  );

  if (onLogin) {
    return (
      <div className="app" data-space="public">
        {skip}
        {main}
      </div>
    );
  }

  if (kind === "tutor" && me.data !== null && me.data !== undefined) {
    return (
      <FocusContext.Provider value={setFocus}>
        <div className="app" data-space="tutor">
          {skip}
          <TutorSidebar me={me.data} pathname={pathname} onLogout={logoutAction.run} />
          <div className="tutor-main">
            {main}
            <Footer learner={false} />
          </div>
        </div>
      </FocusContext.Provider>
    );
  }

  return (
    <FocusContext.Provider value={setFocus}>
      <div className="app" data-space={kind ?? "public"}>
        {skip}
        {!(focus && kind === "learner") && (
          <TopBar
            kind={kind === "tutor" ? undefined : kind}
            pathname={pathname}
            onLogout={logoutAction.run}
          />
        )}
        {main}
        {!(focus && kind === "learner") && <Footer learner={kind === "learner"} />}
      </div>
    </FocusContext.Provider>
  );
}

export { useLogout };
