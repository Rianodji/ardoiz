/**
 * L'application dans son IMAGE DE PRODUCTION (L7) : le conteneur tourne comme sur le serveur, en
 * lecture seule, uid non nul, sans capacité, avec un volume pour les fichiers. Les migrations passent
 * par le migrateur de l'image et l'espace est créé par la commande init-space de l'image.
 * Seules diffèrent la configuration (origine localhost, Mailpit) et le réseau (celui de l'hôte).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { E2eBackend, E2eDatabase } from "./backend.js";

function docker(args: readonly string[], input?: string): string {
  const result = spawnSync("docker", args, { encoding: "utf8", ...(input === undefined ? {} : { input }) });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args[0] ?? ""} a échoué (${String(result.status)}) :\n${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout.trim();
}

const HARDENED = [
  "--network",
  "host",
  "--read-only",
  "--tmpfs",
  "/tmp",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
];

export async function startImage(
  image: string,
  database: E2eDatabase,
  mailpitUrl: string,
  port: number,
  metricsPort: number,
): Promise<E2eBackend> {
  docker([
    "run",
    "--rm",
    ...HARDENED,
    "-e",
    `MIGRATION_DATABASE_URL=${database.ownerUrl}`,
    image,
    "apps/api/dist/platform/postgres/migrate-cli.js",
  ]);

  const origin = `http://localhost:${String(port)}`;
  const env = {
    NODE_ENV: "development",
    PUBLIC_BASE_URL: origin,
    HOST: "127.0.0.1",
    PORT: String(port),
    METRICS_PORT: String(metricsPort),
    LOG_LEVEL: "warn",
    DATABASE_URL: database.appUrl,
    SESSION_SECRET: randomBytes(32).toString("base64"),
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MAIL_TRANSPORT: "mailpit",
    MAILPIT_URL: mailpitUrl,
  };
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const container = docker(["run", "-d", ...HARDENED, "-v", "/data/files", ...envArgs, image]);

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${origin}/readyz`)).ok) break;
    } catch {
      // pas encore prêt
    }
    if (Date.now() > deadline) {
      const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
      throw new Error(`L'image n'est pas prête :\n${logs.stdout}${logs.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    origin,
    initSpace: (input) => {
      docker(
        [
          "run",
          "--rm",
          "-i",
          ...HARDENED,
          ...envArgs,
          image,
          "apps/api/dist/app/cli.js",
          "init-space",
          "--space-name",
          input.spaceName,
          "--space-code",
          input.spaceCode,
          "--tutor-email",
          input.tutorEmail,
          "--tutor-name",
          input.tutorName,
        ],
        `${input.tutorPassword}\n`,
      );
      return Promise.resolve();
    },
    close: () => {
      docker(["rm", "-f", "-v", container]);
      return Promise.resolve();
    },
  };
}
