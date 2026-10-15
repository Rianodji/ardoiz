/**
 * Logo d'Ardoiz (docs/design/logo/ardoiz-logo.svg), redessiné en SVG React : ses couleurs viennent des
 * jetons de la feuille de style (charte §2), et il reste décoratif, car le nom « Ardoiz » l'accompagne.
 */
export function Logo({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className === undefined ? "logo" : `logo ${className}`}
      viewBox="0 0 240 240"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="10" y="10" width="220" height="220" rx="44" className="logo-frame" />
      <rect x="34" y="34" width="172" height="172" rx="26" className="logo-slate" />
      <path d="M78 170 L120 66 L162 170" className="logo-chalk" strokeWidth="16" />
      <path d="M95 132 Q120 124 146 131" className="logo-chalk" strokeWidth="13" />
      <path d="M150 190 h28" className="logo-accent" strokeWidth="9" />
    </svg>
  );
}
