import { rmSync } from "node:fs";

/** Arrête le serveur de bout en bout (il arrête lui-même sa base jetable). */
export default async function globalTeardown(): Promise<void> {
  rmSync(`${process.env["E2E_STATE_FILE"] ?? ""}.totp`, { force: true });
  const pid = Number(process.env["E2E_SERVER_PID"]);
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // déjà arrêté
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}
