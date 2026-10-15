import { useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { Icon, type IconNode } from "./Icon";

/**
 * Composants partagés de la charte (§5). Tout le style est dans styles.css, par classes : la CSP
 * (`style-src 'self'`) interdit les attributs `style` écrits dans le HTML (charte §9).
 */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const buttonClass = (variant: ButtonVariant, extra?: string) =>
  `btn btn-${variant}${extra === undefined ? "" : ` ${extra}`}`;

/** Bouton : principal, secondaire, discret ou destructif (ce dernier est toujours confirmé par l'appelant). */
export function Button({
  variant = "primary",
  icon,
  iconAfter,
  className,
  type = "button",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly icon?: IconNode;
  readonly iconAfter?: IconNode;
}) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      {icon !== undefined && <Icon icon={icon} />}
      {children}
      {iconAfter !== undefined && <Icon icon={iconAfter} />}
    </button>
  );
}

/** Lien de navigation présenté comme un bouton (« Commencer le devoir », « Voir le cours »). */
export function ButtonLink({
  variant = "primary",
  icon,
  className,
  children,
  ...rest
}: LinkProps & { readonly variant?: ButtonVariant; readonly icon?: IconNode }) {
  return (
    <Link className={buttonClass(variant, className)} {...rest}>
      {icon !== undefined && <Icon icon={icon} />}
      {children}
    </Link>
  );
}

export type PillTone = "done" | "todo" | "soon" | "closed" | "points" | "info" | "alert" | "neutral";

/** Pastille d'état : toujours un mot, et une icône si utile ; jamais la couleur seule (charte §1, §5). */
export function Pill({
  tone,
  icon,
  children,
}: {
  readonly tone: PillTone;
  readonly icon?: IconNode;
  readonly children: ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon !== undefined && <Icon icon={icon} />}
      {children}
    </span>
  );
}

/** Carte : fond papier, bordure fine, sans ombre (charte §4). */
export function Card({
  as: Tag = "section",
  className,
  children,
  ...rest
}: {
  readonly as?: "section" | "article" | "div" | "aside";
  readonly className?: string | undefined;
  readonly children: ReactNode;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
}) {
  return (
    <Tag className={className === undefined ? "card" : `card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** En-tête de page : surtitre (date), titre, phrase d'aide, actions en tête de page (charte §1, tuteur). */
export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  className,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <header className={className === undefined ? "page-header" : `page-header ${className}`}>
      <div className="page-header-text">
        {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {lead !== undefined && <p className="lead">{lead}</p>}
      </div>
      {actions !== undefined && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export interface FieldControlProps {
  readonly id: string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: true;
}

/**
 * Champ : libellé au-dessus, en gras ; aide et erreur sous le champ, reliées par `aria-describedby`.
 * L'erreur dit quoi faire (charte §5, §7).
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly className?: string;
  readonly children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-aide`;
  const errorId = `${id}-erreur`;
  const hasError = error !== undefined && error !== null && error !== "";
  const describedBy = [hint === undefined ? null : hintId, hasError ? errorId : null]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <div className={className === undefined ? "field" : `field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
        ...(hasError ? { "aria-invalid": true as const } : {}),
      })}
      {hint !== undefined && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {hasError && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

export interface TabItem<K extends string> {
  readonly key: K;
  readonly label: ReactNode;
}

/**
 * Onglets accessibles (motif ARIA « tabs ») : flèches gauche et droite, Début et Fin. Soulignement vert
 * pour l'adulte, pastille menthe pour l'élève (charte §5).
 */
export function Tabs<K extends string>({
  label,
  tabs,
  selected,
  onSelect,
  variant = "underline",
  head,
  children,
}: {
  readonly label: string;
  /** Titre de la page, à gauche des onglets (le parent choisit son enfant à droite du titre). */
  readonly head?: ReactNode;
  readonly tabs: ReadonlyArray<TabItem<K>>;
  readonly selected: K;
  readonly onSelect: (key: K) => void;
  readonly variant?: "underline" | "pill";
  readonly children: ReactNode;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const tabId = (key: string) => `${id}-onglet-${key}`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.key === selected);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined || tabs.length === 0) return;
    event.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length];
    if (next === undefined) return;
    onSelect(next.key);
    list.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.key))}`)?.focus();
  };
  return (
    <div className={`tabs tabs-${variant}`}>
      <div className={head === undefined ? "tabs-bar" : "tabs-bar with-head"}>
        {head}
        <div role="tablist" aria-label={label} className="tablist" ref={list} onKeyDown={onKeyDown}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              id={tabId(tab.key)}
              type="button"
              role="tab"
              aria-selected={tab.key === selected}
              aria-controls={`${id}-panneau`}
              tabIndex={tab.key === selected ? 0 : -1}
              className="tab"
              onClick={() => {
                onSelect(tab.key);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`${id}-panneau`} aria-labelledby={tabId(selected)} className="tabpanel">
        {children}
      </div>
    </div>
  );
}

/** Tableau dans une boîte à défilement horizontal sur petit écran (charte §5) ; la boîte est focalisable. */
export function TableBox({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    // La boîte défile au clavier : elle est donc focalisable et nommée (WCAG 2.1.1).
    <div className="table-box" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table">{children}</table>
    </div>
  );
}

/** Barre de progression native : aucune largeur calculée à écrire en style (charte §9). */
export function ProgressBar({
  value,
  max,
  label,
  tone = "sun",
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly tone?: "sun" | "green";
}) {
  return (
    <progress className={`progress progress-${tone}`} value={Math.max(0, value)} max={max} aria-label={label}>
      {Math.round((Math.max(0, value) / Math.max(1, max)) * 100)} %
    </progress>
  );
}

/** Chiffre clé : petite légende en capitales, valeur en grand, précision dessous (parent, tuteur). */
export function Stat({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
}) {
  return (
    <div className="card stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {detail !== undefined && <p className="stat-detail">{detail}</p>}
    </div>
  );
}

/** Phrase d'état vide ou d'information, sur fond doux. */
export function Notice({
  tone = "info",
  icon,
  children,
}: {
  readonly tone?: "info" | "success" | "warning" | "locked";
  readonly icon?: IconNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`}>
      {icon !== undefined && <Icon icon={icon} />}
      <div>{children}</div>
    </div>
  );
}
