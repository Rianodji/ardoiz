import pino from "pino";
import { loadConfig } from "../platform/config/loadConfig.js";
import { loggerOptions } from "../platform/logging/logger.js";
import { createPool, databaseReadiness } from "../platform/postgres/pool.js";
import { buildServer } from "./buildServer.js";

/** Démarrage : configuration validée d'abord ; une configuration invalide arrête le processus (R20). */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createPool({ connectionString: config.databaseUrl, max: config.databasePoolMax });
  const app = await buildServer({ config, readiness: databaseReadiness(pool) });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  pino(loggerOptions("info")).fatal({ err: error }, "démarrage impossible");
  process.exitCode = 1;
});
