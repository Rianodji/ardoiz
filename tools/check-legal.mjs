// Bloquant avant tout déploiement en production (jalons L7) : plus aucun élément à compléter `[[…]]`
// dans les textes juridiques affichés (docs/juridique). Le README de ce répertoire, qui décrit la
// convention, n'est pas affiché et n'est pas vérifié.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../docs/juridique", import.meta.url));
const pending = [];
for (const file of readdirSync(DIR)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort()) {
  readFileSync(join(DIR, file), "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.includes("[[")) pending.push(`${file}:${String(index + 1)} : ${line.trim()}`);
    });
}
if (pending.length > 0) {
  process.stderr.write(
    `Textes juridiques à compléter avant la production (${String(pending.length)}) :\n  ${pending.join("\n  ")}\n`,
  );
  process.exit(1);
}
process.stdout.write("Textes juridiques complets : aucun [[…]].\n");
