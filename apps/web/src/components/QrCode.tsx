import { encode } from "uqr";

/**
 * QR code rendu en SVG par React, à partir de la matrice calculée dans le navigateur (verdict L1,
 * R-6) : l'URI otpauth:// et son secret ne quittent jamais la page. Aucun HTML brut ni style en
 * ligne : un seul chemin, compatible avec la CSP (R4, R11).
 */
export function QrCode({ value, label }: { readonly value: string; readonly label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 4 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${String(x)} ${String(y)}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
