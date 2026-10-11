import { Secret } from "./Secret.js";

export type Environment = "production" | "development" | "test";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug";

export interface AppConfig {
  readonly environment: Environment;
  /** Origine publique de l'application (SPA et API) : seule origine acceptée pour les écritures (R11). */
  readonly publicOrigin: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: Secret;
  readonly databasePoolMax: number;
  /** Répertoire de la SPA compilée, servie par l'API sur la même origine (ADR-0006). */
  readonly webDistDir?: string;
}

export interface MigrationConfig {
  readonly migrationDatabaseUrl: Secret;
}

/** Le message nomme la variable et la raison, jamais la valeur reçue (R20). */
export class ConfigurationError extends Error {
  constructor(
    readonly variable: string,
    reason: string,
  ) {
    super(`Configuration invalide : ${variable} (${reason}).`);
    this.name = "ConfigurationError";
  }
}

/** Rôles qui ne doivent jamais servir à l'exécution : ils contournent ou possèdent la RLS (R10, ADR-0002). */
const FORBIDDEN_RUNTIME_DB_USERS = new Set(["ardoiz_owner", "postgres"]);
const ENVIRONMENTS: readonly Environment[] = ["production", "development", "test"];
const LOG_LEVELS: readonly LogLevel[] = ["fatal", "error", "warn", "info", "debug"];
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") throw new ConfigurationError(name, "absente");
  return value.trim();
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback?: T): T {
  const raw = fallback === undefined ? required(env, name) : (optional(env, name) ?? fallback);
  const found = allowed.find((candidate) => candidate === raw);
  if (found === undefined) throw new ConfigurationError(name, `valeur attendue : ${allowed.join(", ")}`);
  return found;
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigurationError(name, "entier attendu");
  const value = Number(raw);
  if (value < min || value > max) throw new ConfigurationError(name, `entre ${min} et ${max}`);
  return value;
}

function publicOrigin(env: Env, environment: Environment): string {
  const name = "PUBLIC_BASE_URL";
  const raw = required(env, name);
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url === null || url.origin !== raw) {
    throw new ConfigurationError(name, "origine attendue, de la forme https://hote[:port], sans chemin");
  }
  // HTTP n'est toléré que pour un poste de développement local, jamais en production (R11, M18).
  const localHttp =
    url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname) && environment !== "production";
  if (url.protocol !== "https:" && !localHttp) throw new ConfigurationError(name, "HTTPS obligatoire");
  return url.origin;
}

function databaseUrl(env: Env, name: string, check: (user: string) => string | null): Secret {
  const raw = required(env, name);
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url === null || (url.protocol !== "postgres:" && url.protocol !== "postgresql:")) {
    throw new ConfigurationError(name, "URL postgres:// attendue");
  }
  const problem = check(decodeURIComponent(url.username));
  if (problem !== null) throw new ConfigurationError(name, problem);
  return new Secret(raw);
}

/**
 * Lecture et validation de la configuration AU DÉMARRAGE (R20) : une application mal configurée
 * refuse de démarrer plutôt que de fonctionner en mode dégradé ou non sécurisé (A02, ADR-0010).
 * Les secrets viennent de l'environnement, jamais du dépôt.
 */
export function loadConfig(env: Env): AppConfig {
  const environment = oneOf(env, "NODE_ENV", ENVIRONMENTS);
  const webDistDir = optional(env, "WEB_DIST_DIR");
  return {
    environment,
    publicOrigin: publicOrigin(env, environment),
    host: optional(env, "HOST") ?? "127.0.0.1",
    port: integer(env, "PORT", 3000, 1, 65535),
    logLevel: oneOf(env, "LOG_LEVEL", LOG_LEVELS, "info"),
    // Le rôle d'exécution est soumis à la RLS : ni propriétaire des tables, ni superutilisateur (R10).
    databaseUrl: databaseUrl(env, "DATABASE_URL", (user) =>
      FORBIDDEN_RUNTIME_DB_USERS.has(user) ? "le rôle d'exécution ne doit pas être propriétaire" : null,
    ),
    // Au plus 10 connexions sur le Postgres partagé du serveur (ADR-0008).
    databasePoolMax: integer(env, "DATABASE_POOL_MAX", 10, 1, 10),
    ...(webDistDir === undefined ? {} : { webDistDir }),
  };
}

/** Configuration de l'outil de migration, exécuté avec le rôle propriétaire (ADR-0002). */
export function loadMigrationConfig(env: Env): MigrationConfig {
  return {
    migrationDatabaseUrl: databaseUrl(env, "MIGRATION_DATABASE_URL", (user) =>
      user === "" ? "utilisateur absent" : null,
    ),
  };
}
