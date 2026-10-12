import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import pino from "pino";
import { createIdentityModule } from "../identity/index.js";
import { loadConfig } from "../platform/config/loadConfig.js";
import { UuidV7IdGenerator } from "../platform/ids/UuidV7IdGenerator.js";
import { loggerOptions } from "../platform/logging/logger.js";
import { createPool } from "../platform/postgres/pool.js";
import { SystemClock } from "../platform/time/SystemClock.js";
import { COMMON_PASSWORDS_FILE, DEFAULT_LEGAL_DIR } from "./paths.js";

const USAGE = `Usage : npm run ardoiz -- init-space --space-name "Espace Dicard" --space-code dicard \\
         --tutor-email tuteur@example.org --tutor-name "Dicard"
Le mot de passe du tuteur est lu sur l'entrée standard (jamais en argument : il finirait dans l'historique).`;

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
 * CLI d'installation (big picture §2) : crée l'espace et son tuteur, une seule fois.
 * Le tuteur devra activer le TOTP à sa première connexion avant toute action (R7).
 */
async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "init-space") {
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
  const spaceName = values["space-name"];
  const spaceCode = values["space-code"];
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

  const config = loadConfig(process.env);
  const log = pino(loggerOptions(config.logLevel));
  const pool = createPool({ connectionString: config.databaseUrl, max: 2 });
  const clock = new SystemClock();
  try {
    const identity = createIdentityModule({
      pool,
      config,
      legalDir: config.legalDir ?? DEFAULT_LEGAL_DIR,
      commonPasswordsFile: COMMON_PASSWORDS_FILE,
      clock,
      ids: new UuidV7IdGenerator(clock),
      log,
    });
    const tutorPassword = await readSecretLine("Mot de passe du tuteur (12 caractères au moins) : ");
    const { tutorSpaceId } = await identity.initSpace({
      spaceName,
      spaceCode,
      tutorEmail,
      tutorName,
      tutorPassword,
    });
    log.info({ tutorSpaceId }, "espace tuteur créé ; activer le TOTP à la première connexion");
  } catch (error) {
    log.fatal({ err: error }, "création de l'espace impossible");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
