import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import pino from "pino";
import { createCurriculumModule } from "../curriculum/index.js";
import { createIdentityModule, PgLearnerDirectory } from "../identity/index.js";
import { createProgressModule } from "../progress/index.js";
import { loadConfig } from "../platform/config/loadConfig.js";
import { UuidV7IdGenerator } from "../platform/ids/UuidV7IdGenerator.js";
import { loggerOptions } from "../platform/logging/logger.js";
import { createPool } from "../platform/postgres/pool.js";
import { SystemClock } from "../platform/time/SystemClock.js";
import { COMMON_PASSWORDS_FILE, DEFAULT_LEGAL_DIR, DEFAULT_MEDIA_DIR, REFERENTIAL_FILE } from "./paths.js";

const USAGE = `Usage : npm run ardoiz -- init-space --space-name "Espace Dicard" --space-code dicard \\
         --tutor-email tuteur@example.org --tutor-name "Dicard"
        npm run ardoiz -- seed-referential --space-code dicard
        npm run ardoiz -- rebuild-progress --space-code dicard
Le mot de passe du tuteur est lu sur l'entrée standard (jamais en argument : il finirait dans l'historique).
init-space charge aussi le référentiel de compétences validé ; seed-referential le recharge sans rien écraser.
rebuild-progress reconstruit la progression d'un espace depuis les événements (les ajustements du tuteur restent).`;

/** Lit une ligne sur l'entrée standard sans l'afficher : l'écho du terminal part dans un flux muet. */
async function readSecretLine(prompt: string): Promise<string> {
  const muted = new Writable({
    write: (_chunk, _encoding, done) => {
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) process.stdout.write(prompt);
  const line = await new Promise<string>((resolve) => rl.once("line", resolve));
  rl.close();
  if (process.stdin.isTTY) process.stdout.write("\n");
  return line;
}

/**
 * CLI d'installation (big picture §2). `init-space` crée l'espace et son tuteur, une seule fois, puis
 * charge le référentiel validé ; le tuteur devra activer le TOTP à sa première connexion (R7).
 * `seed-referential` recharge le référentiel dans un espace existant, sans rien écraser.
 */
async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "init-space" && command !== "seed-referential" && command !== "rebuild-progress") {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      "space-name": { type: "string" },
      "space-code": { type: "string" },
      "tutor-email": { type: "string" },
      "tutor-name": { type: "string" },
    },
    strict: true,
  });

  const config = loadConfig(process.env);
  const log = pino(loggerOptions(config.logLevel));
  const pool = createPool({ connectionString: config.databaseUrl, max: 2 });
  const clock = new SystemClock();
  const ids = new UuidV7IdGenerator(clock);
  try {
    const identity = createIdentityModule({
      pool,
      config,
      legalDir: config.legalDir ?? DEFAULT_LEGAL_DIR,
      commonPasswordsFile: COMMON_PASSWORDS_FILE,
      clock,
      ids,
      log,
    });
    const curriculum = createCurriculumModule({
      pool,
      mediaDir: config.mediaDir ?? DEFAULT_MEDIA_DIR,
      referentialFile: REFERENTIAL_FILE,
      clock,
      ids,
    });

    const spaceCode = values["space-code"];
    if (command === "rebuild-progress") {
      const tutorSpaceId = spaceCode === undefined ? null : await identity.spaceIdByCode(spaceCode);
      if (tutorSpaceId === null) {
        process.stderr.write(`${USAGE}\n`);
        process.exitCode = 2;
        return;
      }
      const progress = createProgressModule({
        pool,
        catalog: curriculum.directory,
        learners: new PgLearnerDirectory(pool),
        clock,
        ids,
      });
      log.info(await progress.rebuild(tutorSpaceId), "progression reconstruite depuis les événements");
      return;
    }
    if (command === "seed-referential") {
      const tutorSpaceId = spaceCode === undefined ? null : await identity.spaceIdByCode(spaceCode);
      if (tutorSpaceId === null) {
        process.stderr.write(`${USAGE}\n`);
        process.exitCode = 2;
        return;
      }
      log.info(await curriculum.seedReferential(tutorSpaceId), "référentiel de compétences chargé");
      return;
    }

    const spaceName = values["space-name"];
    const tutorEmail = values["tutor-email"];
    const tutorName = values["tutor-name"];
    if (
      spaceName === undefined ||
      spaceCode === undefined ||
      tutorEmail === undefined ||
      tutorName === undefined
    ) {
      process.stderr.write(`${USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    const tutorPassword = await readSecretLine("Mot de passe du tuteur (12 caractères au moins) : ");
    const { tutorSpaceId } = await identity.initSpace({
      spaceName,
      spaceCode,
      tutorEmail,
      tutorName,
      tutorPassword,
    });
    const { added } = await curriculum.seedReferential(tutorSpaceId);
    log.info(
      { tutorSpaceId, competencies: added },
      "espace tuteur créé ; activer le TOTP à la première connexion",
    );
  } catch (error) {
    log.fatal({ err: error }, "commande impossible");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
