import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../../deploy/remote-deploy.sh", import.meta.url));

/** Exécute le script de déploiement avec un faux `docker` qui journalise ses appels (et peut échouer). */
function deploy(args: string[], failOn?: string) {
  const home = mkdtempSync(join(tmpdir(), "ardoiz-deploy-"));
  const bin = join(home, "bin");
  mkdirSync(join(home, "ardoiz"));
  mkdirSync(bin);
  writeFileSync(
    join(home, "ardoiz", ".env.migrate"),
    "MIGRATION_DATABASE_URL=postgres://owner:secret@db/ardoiz\n",
  );
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env bash\necho "$*" >> "${home}/docker.log"\n${failOn === undefined ? "" : `case "$*" in *${failOn}*) exit 1 ;; esac\n`}exit 0\n`,
  );
  chmodSync(join(bin, "docker"), 0o755);
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env["PATH"] ?? ""}`, HOME: home },
  });
  const log = existsSync(join(home, "docker.log")) ? readFileSync(join(home, "docker.log"), "utf8") : "";
  return {
    status: result.status,
    log,
    envMigrateLeft: existsSync(join(home, "ardoiz", ".env.migrate")),
    home,
  };
}

describe("Script de déploiement sur le serveur (L7)", () => {
  it("efface .env.migrate après la migration (verdict L7, S-2)", () => {
    const run = deploy(["v1.0.0", "migrate"]);
    expect(run.status).toBe(0);
    expect(run.log).toContain("--profile migrate run --rm ardoiz-migrate");
    expect(run.envMigrateLeft).toBe(false);
    expect(readFileSync(join(run.home, "ardoiz", "deployed-tag"), "utf8").trim()).toBe("v1.0.0");
  });

  it("efface aussi .env.migrate quand la migration échoue, sans redémarrer l'application (S-2)", () => {
    const run = deploy(["v1.0.0", "migrate"], "ardoiz-migrate");
    expect(run.status).not.toBe(0);
    expect(run.envMigrateLeft).toBe(false);
    expect(run.log).not.toContain("up -d");
  });

  it("un retour arrière ne migre pas", () => {
    const run = deploy(["v0.9.0", "no-migrate"]);
    expect(run.status).toBe(0);
    expect(run.log).not.toContain("ardoiz-migrate");
    expect(run.log).toContain("up -d --wait");
  });

  it("refuse un tag ou un mode mal formés, avant toute commande", () => {
    for (const args of [
      ["v1.0", "migrate"],
      ["v1.0.0; rm -rf ~", "migrate"],
      ["v1.0.0", "tout"],
    ]) {
      const run = deploy(args);
      expect(run.status).toBe(2);
      expect(run.log).toBe("");
      expect(run.envMigrateLeft).toBe(false);
    }
  });
});
