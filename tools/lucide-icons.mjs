// Produit apps/web/src/ui/icons.ts : les icônes Lucide utilisées par Ardoiz, recopiées une à une (L8,
// charte §4). Aucune bibliothèque d'icônes n'est livrée ; seules ces données de tracé le sont.
// Usage (dans un dossier vide, hors du dépôt) :
//   npm pack lucide-static@1.57.0 && tar -xzf lucide-static-1.57.0.tgz
//   node tools/lucide-icons.mjs <dossier>/package/icon-nodes.json 1.57.0 > apps/web/src/ui/icons.ts
//   npx prettier --write apps/web/src/ui/icons.ts
// Ajouter une icône : son nom Lucide dans la liste ci-dessous, puis relancer.
import { readFileSync } from "node:fs";

const [nodesPath, version] = process.argv.slice(2);
const nodes = JSON.parse(readFileSync(nodesPath, "utf8"));
const WANT = [
  "house",
  "user",
  "book-text",
  "clipboard-check",
  "star",
  "users",
  "check",
  "clock",
  "calendar",
  "lock",
  "video",
  "award",
  "triangle",
  "chart-column",
  "app-window",
  "trending-up",
  "rotate-ccw",
  "chevron-left",
  "chevron-right",
  "play",
  "pencil",
  "archive",
  "arrow-up",
  "log-out",
  "monitor",
  "smartphone",
  "x",
  "plus",
  "minus",
  "message-square",
  "clipboard-list",
];
const pascal = (name) =>
  name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
const attribute = (key) => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

let out = `/* Fichier généré par tools/lucide-icons.mjs : ne pas modifier à la main.
 * Icônes Lucide ${version} (licence ISC, © Lucide Icons and Contributors ; certaines dérivées de Feather,
 * MIT, © Cole Bemis), recopiées une à une : aucune bibliothèque d'icônes n'est livrée, et chaque icône
 * non utilisée disparaît à la construction. Texte des licences : THIRD-PARTY-NOTICES. */
import type { IconNode } from "./Icon";

`;
for (const name of WANT) {
  const node = nodes[name];
  if (node === undefined) throw new Error(`icône absente : ${name}`);
  const parts = node.map(([tag, attributes]) => {
    const list = Object.entries(attributes)
      .filter(([key]) => key !== "key")
      .map(([key, value]) => `${attribute(key)}: ${JSON.stringify(value)}`)
      .join(", ");
    return `["${tag}", { ${list} }]`;
  });
  out += `export const ${pascal(name)}: IconNode = [${parts.join(", ")}];\n`;
}
process.stdout.write(out);
