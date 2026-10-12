/**
 * Serveur des tests de bout en bout (Playwright) : la VRAIE application, avec ses en-têtes de
 * production (CSP, HSTS, Origin), qui sert la SPA construite, sur un PostgreSQL jetable migré.
 * Seuls changent la boîte d'envoi (en mémoire, pour lire les invitations) et l'origine (localhost).
 * Il prépare un espace de démonstration, écrit son état dans un fichier, puis attend d'être arrêté.
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import pino from "pino";
import { buildServer } from "../apps/api/src/app/buildServer.js";
import { COMMON_PASSWORDS_FILE, DEFAULT_LEGAL_DIR, REFERENTIAL_FILE } from "../apps/api/src/app/paths.js";
import { createAssessmentModule } from "../apps/api/src/assessment/index.js";
import { createCurriculumModule } from "../apps/api/src/curriculum/index.js";
import { createIdentityModule, PgLearnerDirectory } from "../apps/api/src/identity/index.js";
import { InMemoryMailer } from "../apps/api/src/identity/infrastructure/mailers.js";
import { UuidV7IdGenerator } from "../apps/api/src/platform/ids/UuidV7IdGenerator.js";
import { loggerOptions } from "../apps/api/src/platform/logging/logger.js";
import { LocalFileStorage } from "../apps/api/src/platform/media/LocalFileStorage.js";
import { SharpImageIngestion } from "../apps/api/src/platform/media/SharpImageIngestion.js";
import { migrate } from "../apps/api/src/platform/postgres/migrate.js";
import { SystemClock } from "../apps/api/src/platform/time/SystemClock.js";
import { Secret } from "../apps/api/src/platform/config/Secret.js";

const POSTGRES_IMAGE =
  "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));
const WEB_DIST_DIR = fileURLToPath(new URL("../apps/web/dist", import.meta.url));
const STATE_FILE = process.env["E2E_STATE_FILE"] ?? join(tmpdir(), "ardoiz-e2e-state.json");

const ADULT_PASSWORD = `Girafe-${randomBytes(6).toString("hex")}-42`;
const LEARNER_PASSWORD = `tortue-${randomBytes(4).toString("hex")}`;
const SPACE_CODE = "demo";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  });
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// --- Base de données jetable, deux rôles comme sur le serveur (ADR-0002) -------------------------
const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("postgres").start();
const adminUrl = new URL(container.getConnectionUri());
const ownerPassword = randomBytes(18).toString("hex");
const appPassword = randomBytes(18).toString("hex");
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`CREATE ROLE ardoiz_owner LOGIN PASSWORD '${ownerPassword}'`);
await admin.query(
  `CREATE ROLE ardoiz_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${appPassword}'`,
);
await admin.query("CREATE DATABASE ardoiz OWNER ardoiz_owner");
await admin.query("REVOKE ALL ON DATABASE ardoiz FROM PUBLIC");
await admin.query("GRANT CONNECT ON DATABASE ardoiz TO ardoiz_user");
await admin.end();
const urlFor = (user: string, password: string) => {
  const url = new URL(adminUrl.toString());
  url.username = user;
  url.password = password;
  url.pathname = "/ardoiz";
  return url.toString();
};
const owner = new pg.Client({ connectionString: urlFor("ardoiz_owner", ownerPassword) });
await owner.connect();
await migrate(owner, MIGRATIONS_DIR);
await owner.end();

// --- Application, assemblée comme dans main.ts --------------------------------------------------
const port = await freePort();
const origin = `http://localhost:${String(port)}`;
const pool = new pg.Pool({ connectionString: urlFor("ardoiz_user", appPassword), max: 5 });
const clock = new SystemClock();
const ids = new UuidV7IdGenerator(clock);
const mailer = new InMemoryMailer();
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
      url: "http://127.0.0.1:1",
      senderEmail: "no-reply@example.test",
      senderName: "Ardoiz",
    },
  },
  legalDir: DEFAULT_LEGAL_DIR,
  commonPasswordsFile: COMMON_PASSWORDS_FILE,
  clock,
  ids,
  log: pino(loggerOptions("warn")),
  mailer,
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
const app = await buildServer({
  config: { publicOrigin: origin, logLevel: "warn", trustedProxies: [], webDistDir: WEB_DIST_DIR },
  readiness: () => Promise.resolve(true),
  modules: [identity, curriculum, assessment],
});
await app.listen({ host: "127.0.0.1", port });

// --- Données de démonstration, créées par l'API comme le ferait un utilisateur -------------------
const jar = new Map<string, string>();
async function call(who: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { origin, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const cookie = jar.get(who);
  if (cookie !== undefined) headers["cookie"] = cookie;
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null) jar.set(who, setCookie.split(";")[0] ?? "");
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${String(response.status)} ${text}`);
  return text === "" ? null : (JSON.parse(text) as unknown);
}

const tutorEmail = "tuteur@example.org";
const { tutorSpaceId } = await identity.initSpace({
  spaceName: "Espace de démonstration",
  spaceCode: SPACE_CODE,
  tutorEmail,
  tutorName: "Dicard",
  tutorPassword: ADULT_PASSWORD,
});
await curriculum.seedReferential(tutorSpaceId);
await call("tutor", "POST", "/api/auth/login/adult", { email: tutorEmail, password: ADULT_PASSWORD });
const { secret } = (await call("tutor", "POST", "/api/auth/totp/enroll")) as { secret: string };
await call("tutor", "POST", "/api/auth/totp/activate", { code: totp(secret) });

const guardianEmail = "awa@example.org";
await call("tutor", "POST", "/api/invitations", { email: guardianEmail });
await identity.background.idle();
const token = [...mailer.sent]
  .reverse()
  .find((mail) => mail.to === guardianEmail)
  ?.text.match(/#jeton=([A-Za-z0-9_-]{43})/)?.[1];
if (token === undefined) throw new Error("Invitation introuvable.");
const consentText = (await call("anon", "GET", "/api/legal/consentement")) as {
  version: string;
  sha256: string;
};
const consent = { accepted: true, version: consentText.version, sha256: consentText.sha256 };
await call("guardian", "POST", "/api/invitations/accept", {
  token,
  password: ADULT_PASSWORD,
  displayName: "Awa",
  consent,
});
const { learnerId } = (await call("guardian", "POST", "/api/learners", {
  firstName: "Lina",
  username: "lina",
  schoolLevel: "5e",
  password: LEARNER_PASSWORD,
  consent,
})) as { learnerId: string };

const referential = (await call("tutor", "GET", "/api/referential")) as {
  subjects: Array<{ id: string; name: string }>;
};
const subjectId = referential.subjects.find((subject) => subject.name === "Mathématiques")?.id ?? "";
const choices = (await call("tutor", "GET", "/api/competencies")) as { competencies: Array<{ id: string }> };
const competencyId = choices.competencies[0]?.id ?? "";
const { id: assessmentId } = (await call("tutor", "POST", "/api/assessments", {
  subjectId,
  title: "Géométrie : tracer un triangle",
})) as { id: string };
await call("tutor", "PUT", `/api/assessments/${assessmentId}/questions`, {
  questions: [
    { kind: "notebook", prompt: "Trace un triangle rectangle.", points: 5, competencyIds: [competencyId] },
  ],
});
const now = Date.now();
const { id: assignmentId } = (await call("tutor", "POST", "/api/assignments", {
  assessmentId,
  audience: { kind: "learner", id: learnerId },
  opensAt: new Date(now - 3_600_000).toISOString(),
  dueAt: new Date(now + 7 * 86_400_000).toISOString(),
  maxAttempts: 1,
  lateAllowed: false,
  publication: "manual",
})) as { id: string };

// Une seconde épreuve de cahier, pour l'essai en émulation tactile (tablette).
const { id: sketchId } = (await call("tutor", "POST", "/api/assessments", {
  subjectId,
  title: "Croquis sur tablette",
})) as { id: string };
await call("tutor", "PUT", `/api/assessments/${sketchId}/questions`, {
  questions: [
    { kind: "notebook", prompt: "Trace une ligne au doigt.", points: 1, competencyIds: [competencyId] },
  ],
});
await call("tutor", "POST", "/api/assignments", {
  assessmentId: sketchId,
  audience: { kind: "learner", id: learnerId },
  opensAt: new Date(now - 3_600_000).toISOString(),
  dueAt: new Date(now + 7 * 86_400_000).toISOString(),
  maxAttempts: 1,
  lateAllowed: false,
  publication: "manual",
});

// Un cours publié avec une formule et un encadré, ouvert à Lina : pages de cours sous la CSP (dette L2).
const { id: moduleId } = (await call("tutor", "POST", "/api/modules", {
  subjectId,
  title: "Grandeurs et mesures",
})) as {
  id: string;
};
const { id: lessonId } = (await call("tutor", "POST", "/api/lessons", {
  moduleId,
  title: "Convertir des longueurs",
})) as {
  id: string;
};
await call("tutor", "PUT", `/api/lessons/${lessonId}/content`, {
  content: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Convertir des longueurs" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "1 km = " },
          { type: "math_inline", attrs: { latex: "10^{3}\\text{ m}" } },
        ],
      },
      {
        type: "callout",
        attrs: { kind: "astuce" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Retiens le tableau." }] }],
      },
      { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
    ],
  },
});
await call("tutor", "POST", `/api/lessons/${lessonId}/publish`);
await call("tutor", "POST", "/api/unlocks", {
  target: { kind: "lesson", id: lessonId },
  audience: { kind: "learner", id: learnerId },
});

writeFileSync(
  STATE_FILE,
  JSON.stringify({
    baseURL: origin,
    spaceCode: SPACE_CODE,
    learner: { username: "lina", password: LEARNER_PASSWORD, id: learnerId },
    // Pas TOTP déjà consommé à l'activation : les tests attendent un pas neuf (anti-rejeu, R7).
    tutor: {
      email: tutorEmail,
      password: ADULT_PASSWORD,
      totpSecret: secret,
      usedStep: Math.floor(Date.now() / 30_000),
    },
    assignmentId,
    lessonId,
  }),
);
process.stdout.write(`e2e prêt sur ${origin}\n`);

const shutdown = async () => {
  await app.close();
  await pool.end();
  await container.stop();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
