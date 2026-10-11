import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig, loadMigrationConfig } from "../../src/platform/config/loadConfig.js";
import { Secret } from "../../src/platform/config/Secret.js";

// Valeurs factices : aucune ne correspond à un environnement réel.
const validEnv = {
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://ardoiz.example.test",
  DATABASE_URL: "postgres://ardoiz_user:mot-de-passe-factice@db.internal:5432/ardoiz",
};

describe("Secret (R20)", () => {
  it("ne se révèle par aucun chemin accidentel (R20)", () => {
    const secret = new Secret("valeur-tres-secrete");
    for (const rendered of [String(secret), JSON.stringify({ secret }), inspect({ nested: { secret } })]) {
      expect(rendered).not.toContain("valeur-tres-secrete");
    }
    expect(secret.reveal()).toBe("valeur-tres-secrete");
  });
});

describe("loadConfig (R20)", () => {
  it("charge une configuration valide sans exposer le mot de passe de la base (R20)", () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      environment: "production",
      publicOrigin: "https://ardoiz.example.test",
      port: 3000,
    });
    expect(JSON.stringify(config)).not.toContain("mot-de-passe-factice");
    expect(inspect(config)).not.toContain("mot-de-passe-factice");
  });

  it.each([
    ["NODE_ENV absent", { NODE_ENV: undefined }],
    ["NODE_ENV inconnu", { NODE_ENV: "staging-debug" }],
    ["PUBLIC_BASE_URL absente", { PUBLIC_BASE_URL: undefined }],
    ["PUBLIC_BASE_URL vide", { PUBLIC_BASE_URL: "   " }],
    ["origine en HTTP en production", { PUBLIC_BASE_URL: "http://ardoiz.example.test" }],
    ["localhost en HTTP en production", { PUBLIC_BASE_URL: "http://localhost:5173" }],
    ["origine avec un chemin", { PUBLIC_BASE_URL: "https://ardoiz.example.test/app" }],
    ["origine générique", { PUBLIC_BASE_URL: "*" }],
    ["DATABASE_URL absente", { DATABASE_URL: undefined }],
    ["DATABASE_URL qui n'est pas Postgres", { DATABASE_URL: "mysql://u:p@h/db" }],
    ["rôle propriétaire à l'exécution", { DATABASE_URL: "postgres://ardoiz_owner:x@db/ardoiz" }],
    ["superutilisateur à l'exécution", { DATABASE_URL: "postgres://postgres:x@db/ardoiz" }],
    ["pool trop grand pour le serveur partagé", { DATABASE_POOL_MAX: "50" }],
    ["port non numérique", { PORT: "trois-mille" }],
    ["niveau de journal inconnu", { LOG_LEVEL: "trace" }],
  ])("refuse de démarrer : %s (R20)", (_label, override) => {
    expect(() => loadConfig({ ...validEnv, ...override })).toThrow(ConfigurationError);
  });

  it("accepte HTTP sur localhost uniquement en développement", () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "development",
      PUBLIC_BASE_URL: "http://localhost:5173",
    });
    expect(config.publicOrigin).toBe("http://localhost:5173");
  });

  it("le message d'erreur nomme la variable mais jamais sa valeur (R20)", () => {
    const bad = { ...validEnv, DATABASE_URL: "postgres://ardoiz_owner:fragment-sensible@db/ardoiz" };
    expect(() => loadConfig(bad)).toThrow(/DATABASE_URL/);
    const error = (() => {
      try {
        loadConfig(bad);
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String(error)).not.toContain("fragment-sensible");
  });

  it("exige l'URL de migration pour l'outil de migration seulement", () => {
    expect(() => loadMigrationConfig({})).toThrow(ConfigurationError);
    expect(
      loadMigrationConfig({ MIGRATION_DATABASE_URL: "postgres://ardoiz_owner:x@db/ardoiz" })
        .migrationDatabaseUrl,
    ).toBeInstanceOf(Secret);
  });
});
