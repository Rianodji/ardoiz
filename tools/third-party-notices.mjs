// Produit THIRD-PARTY-NOTICES : la licence et le texte de licence de chaque dépendance LIVRÉE (API et
// SPA compilée), plus le texte de la LGPL-3.0 et l'adresse des sources de libvips (Q14, L7).
// Même liste que tools/check-licenses.mjs : `npm ls --omit=dev --all`. Sans dépendance supplémentaire.
// Usage : node tools/third-party-notices.mjs > THIRD-PARTY-NOTICES
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

const output = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const [root, ...rest] = output.split("\n").filter(Boolean);
const directories = [...new Set(rest)].filter((directory) => directory !== root);

const packages = [];
for (const directory of directories) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (pkg.name?.startsWith("@ardoiz/")) continue;
  const license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "INCONNUE");
  const files = readdirSync(directory)
    .filter((file) => LICENSE_FILE.test(file))
    .sort();
  packages.push({ name: pkg.name, version: pkg.version, license, directory, files });
}
packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

const rule = "=".repeat(78);
const parts = [
  "Ardoiz — avis des tiers (THIRD-PARTY-NOTICES)",
  "",
  "Ardoiz est distribué sous licence AGPL-3.0-only (fichier LICENSE).",
  `L'image contient les ${packages.length} dépendances suivantes, avec leur licence et, quand le paquet le fournit,`,
  "le texte de cette licence. Les paquets @ardoiz/* sont le code d'Ardoiz.",
  "",
];
for (const pkg of packages) {
  parts.push(rule, `${pkg.name}@${pkg.version} — ${pkg.license}`, rule);
  if (pkg.files.length === 0)
    parts.push(`(Le paquet ne contient pas de fichier de licence ; licence déclarée : ${pkg.license}.)`, "");
  for (const file of pkg.files)
    parts.push(`--- ${file}`, readFileSync(join(pkg.directory, file), "utf8").trimEnd(), "");
}

// Ressources recopiées dans la SPA, hors npm (L8) : polices auto-hébergées (OFL-1.1) et icônes Lucide (ISC).
const VENDORED = [
  {
    title: "Lexend (police variable, sous-ensemble latin) — OFL-1.1",
    source:
      "Fichier apps/web/src/assets/fonts/lexend-latin-wght.woff2, issu de @fontsource-variable/lexend 5.3.0.",
    license: "apps/web/src/assets/fonts/OFL-Lexend.txt",
  },
  {
    title: "Atkinson Hyperlegible (400, 700, italique 400 ; sous-ensemble latin) — OFL-1.1",
    source:
      "Fichiers apps/web/src/assets/fonts/atkinson-hyperlegible-latin-*.woff2, issus de @fontsource/atkinson-hyperlegible 5.3.0.",
    license: "apps/web/src/assets/fonts/OFL-Atkinson-Hyperlegible.txt",
  },
  {
    title: "Lucide 1.57.0 (icônes recopiées une à une) — ISC ; icônes dérivées de Feather — MIT",
    source: "Tracés recopiés dans apps/web/src/ui/icons.ts depuis lucide-static 1.57.0.",
    license: "apps/web/src/ui/LICENSE-lucide.txt",
  },
];
for (const entry of VENDORED) {
  parts.push(
    rule,
    entry.title,
    rule,
    entry.source,
    "",
    readFileSync(join(ROOT, entry.license), "utf8").trimEnd(),
    "",
  );
}

// libvips (LGPL-3.0-or-later), embarquée par sharp, liée dynamiquement et non modifiée (Q14).
const libvips = join(ROOT, "node_modules/@img/sharp-libvips-linux-x64");
const vips = existsSync(join(libvips, "versions.json"))
  ? JSON.parse(readFileSync(join(libvips, "versions.json"), "utf8")).vips
  : "inconnue";
const prebuilt = existsSync(join(libvips, "package.json"))
  ? JSON.parse(readFileSync(join(libvips, "package.json"), "utf8")).version
  : "inconnue";
parts.push(
  rule,
  "libvips — LGPL-3.0-or-later (Q14)",
  rule,
  `L'image contient libvips ${vips}, fournie par le paquet @img/sharp-libvips-linux-x64@${prebuilt}.`,
  "Elle est liée dynamiquement par sharp et n'a pas été modifiée.",
  "Sources de libvips : https://github.com/libvips/libvips",
  `  version ${vips} : https://github.com/libvips/libvips/releases/tag/v${vips}`,
  `Scripts de construction du binaire : https://github.com/lovell/sharp-libvips/tree/v${prebuilt}`,
  "Les bibliothèques embarquées avec libvips, et leurs versions, sont listées dans versions.json de ce paquet.",
  "La LGPL-3.0 complète la GPL-3.0 : les deux textes suivent.",
  "",
  "--- LGPL-3.0",
  readFileSync(join(ROOT, "deploy/licenses/LGPL-3.0.txt"), "utf8").trimEnd(),
  "",
  "--- GPL-3.0",
  readFileSync(join(ROOT, "deploy/licenses/GPL-3.0.txt"), "utf8").trimEnd(),
  "",
);
process.stdout.write(`${parts.join("\n")}\n`);
