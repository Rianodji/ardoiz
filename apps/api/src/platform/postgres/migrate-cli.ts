import { fileURLToPath } from "node:url";
import pg from "pg";
import pino from "pino";
import { loadMigrationConfig } from "../config/loadConfig.js";
import { loggerOptions } from "../logging/logger.js";
import { migrate } from "./migrate.js";

/** Point d'entrée du conteneur éphémère de migration (ADR-0008) : rôle propriétaire, puis sortie. */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../db/migrations", import.meta.url));

const log = pino(loggerOptions("info"));
const config = loadMigrationConfig(process.env);
const client = new pg.Client({
  connectionString: config.migrationDatabaseUrl.reveal(),
  application_name: "ardoiz-migrate",
});

try {
  await client.connect();
  const applied = await migrate(client, process.env["MIGRATIONS_DIR"] ?? MIGRATIONS_DIR);
  log.info({ applied }, applied.length === 0 ? "base à jour" : "migrations appliquées");
} catch (error) {
  log.fatal({ err: error }, "échec de la migration");
  process.exitCode = 1;
} finally {
  await client.end();
}
