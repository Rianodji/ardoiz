import pino from "pino";
import { createAssessmentModule } from "../assessment/index.js";
import { createCurriculumModule } from "../curriculum/index.js";
import { createIdentityModule, PgLearnerDirectory } from "../identity/index.js";
import { loadConfig } from "../platform/config/loadConfig.js";
import { UuidV7IdGenerator } from "../platform/ids/UuidV7IdGenerator.js";
import { loggerOptions } from "../platform/logging/logger.js";
import { createPool, databaseReadiness } from "../platform/postgres/pool.js";
import { SystemClock } from "../platform/time/SystemClock.js";
import { buildServer } from "./buildServer.js";
import { COMMON_PASSWORDS_FILE, DEFAULT_LEGAL_DIR, DEFAULT_MEDIA_DIR, REFERENTIAL_FILE } from "./paths.js";

/** Démarrage : configuration validée d'abord ; une configuration invalide arrête le processus (R20). */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const log = pino(loggerOptions(config.logLevel));
  const pool = createPool({ connectionString: config.databaseUrl, max: config.databasePoolMax });
  const clock = new SystemClock();
  const identity = createIdentityModule({
    pool,
    config,
    legalDir: config.legalDir ?? DEFAULT_LEGAL_DIR,
    commonPasswordsFile: COMMON_PASSWORDS_FILE,
    clock,
    ids: new UuidV7IdGenerator(clock),
    log,
  });
  const curriculum = createCurriculumModule({
    pool,
    mediaDir: config.mediaDir ?? DEFAULT_MEDIA_DIR,
    referentialFile: REFERENTIAL_FILE,
    clock,
    ids: new UuidV7IdGenerator(clock),
  });
  const assessment = createAssessmentModule({
    pool,
    curriculum: curriculum.directory,
    learners: new PgLearnerDirectory(pool),
    clock,
    ids: new UuidV7IdGenerator(clock),
  });
  const app = await buildServer({
    config,
    readiness: databaseReadiness(pool),
    modules: [identity, curriculum, assessment],
  });

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
