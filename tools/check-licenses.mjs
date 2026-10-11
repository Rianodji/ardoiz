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
  if (!isAllowed(license)) failures.push(`${pkg.name}@${pkg.version} : ${license}`);
}

if (failures.length > 0) {
  process.stderr.write(`Licences non autorisées (${failures.length}) :\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
process.stdout.write(`Licences vérifiées : ${checked} dépendances livrées, toutes permissives.\n`);
