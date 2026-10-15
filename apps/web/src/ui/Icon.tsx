import { createElement } from "react";

/** Dessin d'une icône Lucide : une liste d'éléments SVG et de leurs attributs (aucun style en ligne). */
export type IconNode = ReadonlyArray<
  readonly ["path" | "rect" | "circle" | "line" | "polyline", Readonly<Record<string, string>>]
>;

/**
 * Icône au trait de 2 px (charte §4). Une icône accompagne toujours un mot (charte §1) : elle est
 * décorative et cachée aux lecteurs d'écran. Seule une icône SANS texte visible reçoit un `label`.
 */
export function Icon({
  icon,
  label,
  className,
}: {
  readonly icon: IconNode;
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      {icon.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
    </svg>
  );
}
