/**
 * Serveur des tests de bout en bout (Playwright) : la VRAIE application, avec ses en-têtes de
 * production (CSP, HSTS, Origin), qui sert la SPA construite, sur un PostgreSQL jetable migré.
 * L'application tourne dans ce processus, ou dans son IMAGE DE PRODUCTION si E2E_IMAGE est donnée
 * (L7). Seuls changent l'origine (localhost) et la boîte d'envoi (un Mailpit jetable, lu par son API).
 * Il prépare un espace de démonstration, écrit son état dans un fichier, puis attend d'être arrêté.
 */
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { GenericContainer } from "testcontainers";
import { startImage } from "./image.js";
import { startInProcess } from "./inProcess.js";
import { invitationToken, MAILPIT_IMAGE } from "./mail.js";

const POSTGRES_IMAGE =
  "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
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

// --- Mailpit jetable : les e-mails sont lus comme un destinataire les lirait ------------------------
const mailpit = await new GenericContainer(MAILPIT_IMAGE).withExposedPorts(8025).start();
const mailpitUrl = `http://127.0.0.1:${String(mailpit.getMappedPort(8025))}`;

// --- Application : dans ce processus, ou dans l'image de production si E2E_IMAGE est donnée (L7) ----
const port = await freePort();
const database = {
  appUrl: urlFor("ardoiz_user", appPassword),
  ownerUrl: urlFor("ardoiz_owner", ownerPassword),
};
const imageName = process.env["E2E_IMAGE"];
const backend =
  imageName === undefined || imageName === ""
    ? await startInProcess(database, mailpitUrl, port)
    : await startImage(imageName, database, mailpitUrl, port, await freePort());
const origin = backend.origin;

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
await backend.initSpace({
  spaceName: "Espace de démonstration",
  spaceCode: SPACE_CODE,
  tutorEmail,
  tutorName: "Dicard",
  tutorPassword: ADULT_PASSWORD,
});
await call("tutor", "POST", "/api/auth/login/adult", { email: tutorEmail, password: ADULT_PASSWORD });
const { secret } = (await call("tutor", "POST", "/api/auth/totp/enroll")) as { secret: string };
await call("tutor", "POST", "/api/auth/totp/activate", { code: totp(secret) });

const guardianEmail = "awa@example.org";
await call("tutor", "POST", "/api/invitations", { email: guardianEmail });
const token = await invitationToken(mailpitUrl, guardianEmail);
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
      // Un tableau large (verdict L8, S-11) : à 360 px, il défile dans sa boîte, la page ne déborde pas.
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Le tableau de conversion" }] },
      {
        type: "table",
        content: [
          ["kilomètre", "hectomètre", "décamètre", "mètre", "décimètre", "centimètre", "millimètre"],
          ["km", "hm", "dam", "m", "dm", "cm", "mm"],
          ["0,001", "0,01", "0,1", "1", "10", "100", "1 000"],
        ].map((row) => ({
          type: "tableRow",
          content: row.map((text) => ({
            type: "tableCell",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          })),
        })),
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

// Lina termine le cours : le relais livre CoursTerminé à la progression (badge « Premier pas », L6).
await call("learner", "POST", "/api/auth/login/learner", {
  spaceCode: SPACE_CODE,
  username: "lina",
  password: LEARNER_PASSWORD,
});
await call("learner", "POST", `/api/lessons/${lessonId}/completion`);
// Le relais tourne en boucle : on attend que la progression ait reçu l'événement.
for (let waited = 0; ; waited += 250) {
  const progress = (await call("learner", "GET", `/api/learners/${learnerId}/progress`)) as { xp: number };
  if (progress.xp >= 10) break;
  if (waited > 30_000) throw new Error("CoursTerminé n'a pas été livré à la progression.");
  await new Promise((resolve) => setTimeout(resolve, 250));
}

// Une séance qui commence dans 10 min (heure de Paris) : la fenêtre du lien est ouverte (R9).
const soon = new Date(Math.ceil((Date.now() + 10 * 60_000) / 300_000) * 300_000);
const [soonDate = "", soonTime = ""] = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
  .format(soon)
  .split(" ");
await call("tutor", "POST", "/api/sessions", {
  title: "Séance de géométrie",
  audience: { kind: "learner", id: learnerId },
  schedule: { kind: "once", date: soonDate, time: soonTime, durationMinutes: 60 },
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
    guardian: { email: guardianEmail, password: ADULT_PASSWORD },
    adultPassword: ADULT_PASSWORD,
    mailpitUrl,
    assignmentId,
    lessonId,
  }),
);
process.stdout.write(`e2e prêt sur ${origin}\n`);

const shutdown = async () => {
  await backend.close();
  await mailpit.stop();
  await container.stop();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
// En mode image, plus rien ne retient ce processus : il doit pourtant vivre (et garder la base et
// Mailpit, que Testcontainers arrête à sa sortie) jusqu'au signal d'arrêt de Playwright.
setInterval(() => undefined, 60_000);
