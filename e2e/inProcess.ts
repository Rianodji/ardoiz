/**
 * L'application dans le processus du serveur de bout en bout, assemblée comme dans main.ts : la vraie
 * application, ses en-têtes de production (CSP, HSTS, Origin) et la SPA construite. Seule l'origine
 * change (localhost) ; les e-mails partent vers un Mailpit jetable.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import pino from "pino";
import { buildServer } from "../apps/api/src/app/buildServer.js";
import { COMMON_PASSWORDS_FILE, DEFAULT_LEGAL_DIR, REFERENTIAL_FILE } from "../apps/api/src/app/paths.js";
import { createAssessmentModule } from "../apps/api/src/assessment/index.js";
import { createCurriculumModule } from "../apps/api/src/curriculum/index.js";
import { createFeedbackModule } from "../apps/api/src/feedback/index.js";
import { createIdentityModule, PgLearnerDirectory } from "../apps/api/src/identity/index.js";
import { Secret } from "../apps/api/src/platform/config/Secret.js";
import { UuidV7IdGenerator } from "../apps/api/src/platform/ids/UuidV7IdGenerator.js";
import { loggerOptions } from "../apps/api/src/platform/logging/logger.js";
import { LocalFileStorage } from "../apps/api/src/platform/media/LocalFileStorage.js";
import { SharpImageIngestion } from "../apps/api/src/platform/media/SharpImageIngestion.js";
import { OutboxRelay, RelayLoop } from "../apps/api/src/platform/messaging/OutboxRelay.js";
import { migrate } from "../apps/api/src/platform/postgres/migrate.js";
import { SystemClock } from "../apps/api/src/platform/time/SystemClock.js";
import { createProgressModule } from "../apps/api/src/progress/index.js";
import { createSchedulingModule } from "../apps/api/src/scheduling/index.js";
import type { E2eBackend, E2eDatabase } from "./backend.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));
const WEB_DIST_DIR = fileURLToPath(new URL("../apps/web/dist", import.meta.url));

export async function startInProcess(
  database: E2eDatabase,
  mailpitUrl: string,
  port: number,
): Promise<E2eBackend> {
  const owner = new pg.Client({ connectionString: database.ownerUrl });
  await owner.connect();
  await migrate(owner, MIGRATIONS_DIR);
  await owner.end();

  const origin = `http://localhost:${String(port)}`;
  const pool = new pg.Pool({ connectionString: database.appUrl, max: 5 });
  const clock = new SystemClock();
  const ids = new UuidV7IdGenerator(clock);
  const mediaDir = mkdtempSync(join(tmpdir(), "ardoiz-e2e-media-"));
  const images = new SharpImageIngestion();
  const identity = createIdentityModule({
    pool,
    config: {
      publicOrigin: origin,
      sessionSecret: new Secret(randomBytes(32).toString("base64")),
      totpEncryptionKey: new Secret(randomBytes(32).toString("base64")),
      mail: {
        transport: "mailpit",
        url: mailpitUrl,
        senderEmail: "no-reply@example.test",
        senderName: "Ardoiz",
      },
    },
    legalDir: DEFAULT_LEGAL_DIR,
    commonPasswordsFile: COMMON_PASSWORDS_FILE,
    clock,
    ids,
    log: pino(loggerOptions("warn")),
  });
  const curriculum = createCurriculumModule({
    pool,
    mediaDir,
    images,
    referentialFile: REFERENTIAL_FILE,
    clock,
    ids,
  });
  const assessment = createAssessmentModule({
    pool,
    curriculum: curriculum.directory,
    learners: new PgLearnerDirectory(pool),
    images,
    files: new LocalFileStorage(mediaDir),
    clock,
    ids,
  });
  const scheduling = createSchedulingModule({
    pool,
    learners: new PgLearnerDirectory(pool),
    groups: curriculum.directory,
    clock,
    ids,
  });
  const progress = createProgressModule({
    pool,
    catalog: curriculum.directory,
    learners: new PgLearnerDirectory(pool),
    clock,
    ids,
  });
  const app = await buildServer({
    config: { publicOrigin: origin, logLevel: "warn", trustedProxies: [], webDistDir: WEB_DIST_DIR },
    readiness: () => Promise.resolve(true),
    modules: [
      identity,
      curriculum,
      assessment,
      scheduling,
      progress,
      createFeedbackModule({ pool, clock, ids }),
    ],
  });
  // Relais en boucle, comme en production.
  const relay = new OutboxRelay(pool, clock);
  for (const subscriber of [...identity.subscribers, ...progress.subscribers]) relay.subscribe(subscriber);
  const relayLoop = new RelayLoop(relay, () => undefined, 200);
  relayLoop.start();
  await app.listen({ host: "127.0.0.1", port });

  return {
    origin,
    initSpace: async (input) => {
      const { tutorSpaceId } = await identity.initSpace(input);
      await curriculum.seedReferential(tutorSpaceId);
    },
    close: async () => {
      await relayLoop.stop();
      await app.close();
      await pool.end();
    },
  };
}
