import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import pino from "pino";
import { inject } from "vitest";
import { buildServer } from "../../../src/app/buildServer.js";
import { COMMON_PASSWORDS_FILE, DEFAULT_LEGAL_DIR, REFERENTIAL_FILE } from "../../../src/app/paths.js";
import { createAssessmentModule } from "../../../src/assessment/index.js";
import { createCurriculumModule, type CurriculumModule } from "../../../src/curriculum/index.js";
import {
  createIdentityModule,
  PgLearnerDirectory,
  type IdentityModule,
} from "../../../src/identity/index.js";
import { InMemoryLoginThrottle } from "../../../src/identity/infrastructure/InMemoryLoginThrottle.js";
import { InMemoryMailer } from "../../../src/identity/infrastructure/mailers.js";
import { Secret } from "../../../src/platform/config/Secret.js";
import { UuidV7IdGenerator } from "../../../src/platform/ids/UuidV7IdGenerator.js";
import { loggerOptions } from "../../../src/platform/logging/logger.js";
import { FixedClock } from "../../support/clock.js";
import { captureLogs } from "../../support/logs.js";

export const ORIGIN = "https://ardoiz.example.test";
/**
 * Mots de passe de test, tirés au hasard à chaque exécution : aucun littéral dans le dépôt, que
 * la détection de secrets prendrait à raison pour un vrai (R20). Ils respectent la politique R8.
 */
export const ADULT_PASSWORD = `Adulte-${randomBytes(8).toString("hex")}-42`;
export const LEARNER_PASSWORD = `eleve-${randomBytes(4).toString("hex")}`;

export interface HttpCall {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly payload?: object;
  readonly cookie?: string;
}

export interface HttpResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | number | undefined>>;
  readonly body: unknown;
  readonly setCookie: string | undefined;
}

/**
 * Un monde de test : une base neuve clonée du modèle migré, le vrai serveur HTTP avec le module
 * identity, une horloge contrôlée et une boîte d'envoi en mémoire. Rien n'est simulé côté base.
 */
/** État figé d'un monde : sa base sert de modèle à des copies indépendantes (une par cas de test). */
export interface Snapshot {
  readonly database: string;
  readonly sessionSecret: Secret;
  readonly totpKey: Secret;
  readonly now: Date;
  readonly mediaDir: string;
  fork(): Promise<World>;
}

export class World {
  readonly clock: FixedClock;
  readonly ids: UuidV7IdGenerator;
  readonly mailer = new InMemoryMailer();
  readonly logs = captureLogs();
  identity!: IdentityModule;
  curriculum!: CurriculumModule;
  app!: FastifyInstance;
  /** Routes enregistrées par le serveur, avec leur niveau d'accès déclaré (pour les tests transverses). */
  readonly routes: Array<{ method: string; url: string; access: string }> = [];

  private constructor(
    readonly database: string,
    readonly pool: pg.Pool,
    readonly sessionSecret: Secret,
    readonly totpKey: Secret,
    now: Date,
    /** Fichiers importés : partagés par les copies d'un même instantané (les noms sont générés, jamais réécrits). */
    readonly mediaDir: string,
  ) {
    this.clock = new FixedClock(now);
    this.ids = new UuidV7IdGenerator(this.clock);
  }

  static async create(
    from: { template?: string; sessionSecret?: Secret; totpKey?: Secret; now?: Date; mediaDir?: string } = {},
  ): Promise<World> {
    const database = `world_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: inject("adminRootUrl") });
    await admin.connect();
    await admin.query(
      `CREATE DATABASE ${database} TEMPLATE ${from.template ?? "ardoiz_template"} OWNER ardoiz_owner`,
    );
    await admin.end();

    const url = new URL(inject("adminRootUrl"));
    url.username = "ardoiz_user";
    url.password = inject("appPassword");
    url.pathname = `/${database}`;
    const world = new World(
      database,
      new pg.Pool({ connectionString: url.toString(), max: 4 }),
      from.sessionSecret ?? new Secret(randomBytes(32).toString("base64")),
      from.totpKey ?? new Secret(randomBytes(32).toString("base64")),
      from.now ?? new Date("2026-10-12T08:00:00Z"),
      from.mediaDir ?? mkdtempSync(join(tmpdir(), "ardoiz-media-")),
    );

    world.identity = createIdentityModule({
      pool: world.pool,
      config: {
        publicOrigin: ORIGIN,
        sessionSecret: world.sessionSecret,
        totpEncryptionKey: world.totpKey,
        mail: {
          transport: "mailpit",
          url: "http://127.0.0.1:1",
          senderEmail: "no-reply@example.test",
          senderName: "Ardoiz",
        },
      },
      legalDir: DEFAULT_LEGAL_DIR,
      commonPasswordsFile: COMMON_PASSWORDS_FILE,
      clock: world.clock,
      ids: world.ids,
      log: pino(loggerOptions("info"), world.logs.stream),
      mailer: world.mailer,
      throttle: new InMemoryLoginThrottle(),
    });
    world.curriculum = createCurriculumModule({
      pool: world.pool,
      mediaDir: world.mediaDir,
      referentialFile: REFERENTIAL_FILE,
      clock: world.clock,
      ids: world.ids,
    });
    world.app = await buildServer({
      config: { publicOrigin: ORIGIN, logLevel: "info", trustedProxies: [] },
      readiness: () => Promise.resolve(true),
      logStream: world.logs.stream,
      modules: [
        {
          statuses: {},
          register: (app) => {
            app.addHook("onRoute", (route) => {
              for (const method of [route.method].flat()) {
                world.routes.push({ method, url: route.url, access: route.config?.access ?? "business" });
              }
            });
            return Promise.resolve();
          },
        },
        world.identity,
        world.curriculum,
        createAssessmentModule({
          pool: world.pool,
          curriculum: world.curriculum.directory,
          learners: new PgLearnerDirectory(world.pool),
          clock: world.clock,
          ids: world.ids,
        }),
      ],
    });
    await world.app.ready();
    return world;
  }

  /** Requête HTTP réelle (sans réseau), depuis notre origine, avec un cookie de session facultatif. */
  async http(call: HttpCall): Promise<HttpResult> {
    const response = await this.app.inject({
      method: call.method,
      url: call.url,
      headers: {
        origin: ORIGIN,
        ...(call.cookie === undefined ? {} : { cookie: call.cookie }),
        ...(call.payload === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(call.payload === undefined ? {} : { payload: JSON.stringify(call.payload) }),
    });
    const setCookie = response.headers["set-cookie"];
    return {
      status: response.statusCode,
      headers: response.headers,
      // Corps JSON analysé ; tout autre corps (image servie par /api/media) reste en octets bruts.
      body:
        response.body === ""
          ? null
          : (response.headers["content-type"] ?? "").includes("json")
            ? (JSON.parse(response.body) as unknown)
            : response.rawPayload,
      setCookie: Array.isArray(setCookie) ? setCookie[0] : setCookie,
    };
  }

  /** Requête d'administration (superutilisateur) sur la base du monde, pour les vérifications. */
  async adminQuery<R extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<R[]> {
    const url = new URL(inject("adminRootUrl"));
    url.pathname = `/${this.database}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      return (await client.query<R>(sql, values)).rows;
    } finally {
      await client.end();
    }
  }

  /**
   * Fige le monde : ferme ses connexions (une base modèle ne doit en avoir aucune) et renvoie
   * de quoi en tirer des copies, avec les mêmes secrets et la même heure : les cookies restent valides.
   */
  async freeze(): Promise<Snapshot> {
    await this.app.close();
    await this.pool.end();
    const { database, sessionSecret, totpKey, mediaDir } = this;
    const now = this.clock.now();
    return {
      database,
      sessionSecret,
      totpKey,
      now,
      mediaDir,
      fork: () => World.create({ template: database, sessionSecret, totpKey, now, mediaDir }),
    };
  }

  /** Supprime une base figée, une fois toutes ses copies fermées. */
  static async drop(database: string): Promise<void> {
    const admin = new pg.Client({ connectionString: inject("adminRootUrl") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
  }

  async close(): Promise<void> {
    await this.app.close();
    await this.pool.end();
    const admin = new pg.Client({ connectionString: inject("adminRootUrl") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${this.database} WITH (FORCE)`);
    await admin.end();
  }
}

/** Valeur du cookie de session à renvoyer, extraite d'un en-tête Set-Cookie. */
export function cookieFrom(setCookie: string | undefined): string {
  const pair = setCookie?.split(";")[0];
  if (pair === undefined || !pair.startsWith("__Host-ardoiz_session="))
    throw new Error("Aucun cookie de session reçu.");
  return pair;
}
