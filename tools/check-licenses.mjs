// Vérifie que chaque dépendance livrée (hors outils de développement) a une licence permissive
// (règle 10 du prompt développeur, R19). Sans dépendance supplémentaire : lit les package.json installés.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Liste blanche de l'architecture (contextes.md §4 ; BlueOak-1.0.0 et 0BSD acceptées par le lead, Q7).
const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "ISC",
  "BlueOak-1.0.0",
]);

/**
 * Exceptions nominatives, en attente de la décision du lead.
 * QUESTION Q14 : sharp (Apache-2.0), imposé par la stack pour réencoder les images (R14), embarque
 * libvips sous LGPL-3.0-or-later, liée dynamiquement et non modifiée. Exception limitée à ces paquets ;
 * la licence LGPL reste refusée pour toute autre dépendance.
 */
const EXCEPTIONS = new Map([
  ["@img/sharp-libvips-linux-x64", "LGPL-3.0-or-later"],
  ["@img/sharp-libvips-linuxmusl-x64", "LGPL-3.0-or-later"],
  ["@img/sharp-wasm32", "Apache-2.0 AND LGPL-3.0-or-later AND MIT"],
  // QUESTION Q18 : trois dépendances d'Excalidraw (ADR-0004), sous des licences permissives absentes de
  // la liste blanche. CC0-1.0 (domaine public), Zlib (approuvée par l'OSI), et fuzzy, dont le
  // package.json n'a pas de champ « license » mais dont le dépôt contient LICENSE-MIT.
  ["fractional-indexing", "CC0-1.0"],
  ["pako", "(MIT AND Zlib)"],
  ["fuzzy", "INCONNUE"],
]);

/** Une expression SPDX « A OR B » est acceptée si l'une des branches l'est ; « A AND B » si toutes le sont. */
function isAllowed(expression) {
  const clean = expression.replace(/[()]/g, "").trim();
  if (clean.includes(" OR ")) return clean.split(" OR ").some(isAllowed);
  if (clean.includes(" AND ")) return clean.split(" AND ").every(isAllowed);
  return ALLOWED.has(clean);
}

const output = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
// La première ligne est la racine du dépôt : Ardoiz lui-même (AGPL-3.0-only) n'est pas une dépendance.
const root = output.split("\n")[0];
const directories = [...new Set(output.split("\n").filter(Boolean))].filter(
  (directory) => directory !== root,
);

const failures = [];
let checked = 0;
for (const directory of directories) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (pkg.name?.startsWith("@ardoiz/")) continue; // nos propres workspaces (privés)
  checked++;
  const license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "INCONNUE");
  if (EXCEPTIONS.get(pkg.name) === license) continue;
  if (!isAllowed(license)) failures.push(`${pkg.name}@${pkg.version} : ${license}`);
}

if (failures.length > 0) {
  process.stderr.write(`Licences non autorisées (${failures.length}) :\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
process.stdout.write(`Licences vérifiées : ${checked} dépendances livrées, toutes permissives.\n`);
