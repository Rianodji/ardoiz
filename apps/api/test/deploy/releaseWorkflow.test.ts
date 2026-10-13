import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOW = readFileSync(
  fileURLToPath(new URL("../../../../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);
const deployJob = WORKFLOW.slice(WORKFLOW.indexOf("\n  deploy:"));

/** Garde-fous du workflow de déploiement, lus dans le fichier (actionlint vérifie la syntaxe en CI). */
describe("Workflow de déploiement (L7)", () => {
  it("un retour arrière déploie le script et le compose DU TAG demandé, pas ceux de la branche (verdict L7, S-3)", () => {
    expect(deployJob).toMatch(
      /ref: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('refs\/tags\/\{0\}', inputs\.tag\) \|\| github\.ref \}\}/,
    );
    // Le checkout avec ce ref précède toute utilisation des fichiers du dépôt.
    expect(deployJob.indexOf("ref: ${{")).toBeLessThan(deployJob.indexOf("deploy/compose.prod.yml"));
    expect(deployJob.indexOf("ref: ${{")).toBeLessThan(deployJob.indexOf("deploy/remote-deploy.sh"));
  });

  it("l'URL du propriétaire n'est déposée que pour migrer (verdict L7, S-2)", () => {
    const upload = deployJob.indexOf(".env.migrate");
    expect(deployJob.lastIndexOf('if [ "$MODE" = "migrate" ]', upload)).toBeGreaterThan(-1);
  });

  it("le déploiement passe par l'environnement production, et aucun secret n'est interpolé dans un script", () => {
    expect(deployJob).toMatch(/environment:\n\s+name: production/);
    for (const script of WORKFLOW.split(/\n\s+run: \|/).slice(1)) {
      const body = script.split(/\n\s{6}- /)[0] ?? "";
      expect(body).not.toMatch(/\$\{\{\s*secrets\./);
    }
  });
});
