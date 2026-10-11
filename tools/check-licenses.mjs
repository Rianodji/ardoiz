// Vérifie que chaque dépendance livrée (hors outils de développement) a une licence permissive
// (règle 10 du prompt développeur, R19). Sans dépendance supplémentaire : lit les package.json installés.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "ISC"]);

/**
 * Exceptions nominatives, en attente de la décision du lead.
 * QUESTION Q7 : BlueOak-1.0.0 (licence permissive approuvée par l'OSI) n'est pas dans la liste du prompt ;
 * elle arrive par @fastify/static, imposé par la stack. Exception limitée à ces paquets, pas à la licence.
 */
const EXCEPTIONS = new Map([
  ["glob", "BlueOak-1.0.0"],
  ["minimatch", "BlueOak-1.0.0"],
  ["minipass", "BlueOak-1.0.0"],
  ["path-scurry", "BlueOak-1.0.0"],
  ["lru-cache", "BlueOak-1.0.0"],
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
const directories = [...new Set(output.split("\n").filter(Boolean))];

const failures = [];
let checked = 0;
for (const directory of directories) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (pkg.name === "ardoiz" || pkg.name?.startsWith("@ardoiz/")) continue; // nos propres paquets
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
