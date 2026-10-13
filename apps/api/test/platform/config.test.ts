import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig, loadMigrationConfig } from "../../src/platform/config/loadConfig.js";
import { Secret } from "../../src/platform/config/Secret.js";

// Valeurs factices : aucune ne correspond à un environnement réel.
const validEnv = {
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://ardoiz.example.test",
  DATABASE_URL: "postgres://ardoiz_user:mot-de-passe-factice@db.internal:5432/ardoiz",
  SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  MAIL_TRANSPORT: "brevo",
  BREVO_API_KEY: "cle-brevo-factice",
  MEDIA_DIR: "/data/files",
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
    ["mandataire de confiance qui n'est pas une adresse", { TRUSTED_PROXIES: "traefik" }],
    ["SESSION_SECRET absent", { SESSION_SECRET: undefined }],
    ["SESSION_SECRET trop court", { SESSION_SECRET: Buffer.alloc(16).toString("base64") }],
    ["TOTP_ENCRYPTION_KEY de mauvaise taille", { TOTP_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") }],
    ["clé Brevo absente", { BREVO_API_KEY: undefined }],
    ["Mailpit en production", { MAIL_TRANSPORT: "mailpit", MAILPIT_URL: "http://127.0.0.1:8025" }],
    ["transport d'e-mail inconnu", { MAIL_TRANSPORT: "sendmail" }],
    ["mandataire de confiance universel", { TRUSTED_PROXIES: "0.0.0.0/0" }],
    ["préfixe CIDR impossible", { TRUSTED_PROXIES: "172.18.0.0/40" }],
  ])("refuse de démarrer : %s (R20)", (_label, override) => {
    expect(() => loadConfig({ ...validEnv, ...override })).toThrow(ConfigurationError);
  });

  it("lit les mandataires de confiance (réseau Docker de Traefik), vides par défaut (réserve R-3)", () => {
    expect(loadConfig(validEnv).trustedProxies).toEqual([]);
    expect(loadConfig({ ...validEnv, TRUSTED_PROXIES: "172.18.0.0/16, 10.0.0.2" }).trustedProxies).toEqual([
      "172.18.0.0/16",
      "10.0.0.2",
    ]);
  });

  it("ne révèle ni le poivre de session, ni la clé TOTP, ni la clé Brevo (R20)", () => {
    const rendered = JSON.stringify(loadConfig(validEnv));
    expect(rendered).not.toContain(validEnv.SESSION_SECRET);
    expect(rendered).not.toContain(validEnv.TOTP_ENCRYPTION_KEY);
    expect(rendered).not.toContain("cle-brevo-factice");
  });

  it("accepte Mailpit en développement, sur une adresse locale seulement", () => {
    const dev = { ...validEnv, NODE_ENV: "development", MAIL_TRANSPORT: "mailpit" };
    expect(loadConfig({ ...dev, MAILPIT_URL: "http://127.0.0.1:8025" }).mail.transport).toBe("mailpit");
    expect(() => loadConfig({ ...dev, MAILPIT_URL: "http://mail.example.org" })).toThrow(ConfigurationError);
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

describe("MEETING_EXTRA_HOST (R9, Q5)", () => {
  it("accepte un nom d'hôte seul, et rien par défaut (R9)", () => {
    expect(loadConfig(validEnv).meetingExtraHost).toBeUndefined();
    expect(loadConfig({ ...validEnv, MEETING_EXTRA_HOST: "visio.example.org" }).meetingExtraHost).toBe(
      "visio.example.org",
    );
  });

  it.each([
    "https://visio.example.org",
    "visio.example.org:8443",
    "*.example.org",
    "localhost",
    "Visio.Example.org",
  ])("refuse « %s » (R9)", (value) => {
    expect(() => loadConfig({ ...validEnv, MEETING_EXTRA_HOST: value })).toThrow(ConfigurationError);
  });
});
