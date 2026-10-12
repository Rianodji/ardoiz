import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { migrate } from "../../src/platform/postgres/migrate.js";

/** Même version que le Postgres partagé du serveur, épinglée par empreinte (octet pour octet en local et en CI). */
const POSTGRES_IMAGE =
  "postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../db/migrations", import.meta.url));

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
    ownerUrl: string;
    appUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

const withCredentials = (base: string, user: string, password: string, database: string): string => {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
};

/**
 * Démarre un PostgreSQL jetable, y crée les deux rôles comme le fera l'infra (ADR-0002, ADR-0008),
 * avec des mots de passe aléatoires tirés à chaque exécution (aucun secret dans le dépôt, R20),
 * puis applique les migrations avec le rôle propriétaire.
 */
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("postgres").start();
  const adminUrl = container.getConnectionUri();
  const ownerPassword = randomBytes(18).toString("hex");
  const appPassword = randomBytes(18).toString("hex");

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE ROLE ardoiz_owner LOGIN PASSWORD '${ownerPassword}'`);
  await admin.query(
    `CREATE ROLE ardoiz_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${appPassword}'`,
  );
  await admin.query("CREATE DATABASE ardoiz OWNER ardoiz_owner");
  // Comme sur le serveur : les rôles des autres projets ne peuvent pas se connecter à la base.
  await admin.query("REVOKE ALL ON DATABASE ardoiz FROM PUBLIC");
  await admin.query("GRANT CONNECT ON DATABASE ardoiz TO ardoiz_user");
  await admin.end();

  const ownerUrl = withCredentials(adminUrl, "ardoiz_owner", ownerPassword, "ardoiz");
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await migrate(owner, MIGRATIONS_DIR);
  await owner.end();

  const adminOnArdoiz = new URL(adminUrl);
  adminOnArdoiz.pathname = "/ardoiz";
  project.provide("adminUrl", adminOnArdoiz.toString());
  project.provide("ownerUrl", ownerUrl);
  project.provide("appUrl", withCredentials(adminUrl, "ardoiz_user", appPassword, "ardoiz"));
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
