import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STATE_FILE = join(tmpdir(), `ardoiz-e2e-${String(process.pid)}.json`);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Démarre le serveur de bout en bout et attend qu'il ait écrit son état (au plus 3 min). */
export default async function globalSetup(): Promise<void> {
  if (!existsSync(join(ROOT, "apps/web/dist/index.html"))) {
    throw new Error("Construire la SPA d'abord : npm run build -w @ardoiz/web");
  }
  rmSync(STATE_FILE, { force: true });
  const server = spawn(
    process.execPath,
    ["--import", "tsx", "--conditions=@ardoiz/source", "e2e/server.ts"],
    {
      cwd: ROOT,
      env: { ...process.env, E2E_STATE_FILE: STATE_FILE },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  process.env["E2E_STATE_FILE"] = STATE_FILE;
  process.env["E2E_SERVER_PID"] = String(server.pid);
  const deadline = Date.now() + 180_000;
  while (!existsSync(STATE_FILE)) {
    if (server.exitCode !== null)
      throw new Error(`Le serveur de bout en bout s'est arrêté (${String(server.exitCode)}).`);
    if (Date.now() > deadline) throw new Error("Le serveur de bout en bout n'a pas démarré à temps.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const { baseURL } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { baseURL: string };
  process.env["E2E_BASE_URL"] = baseURL;
}
