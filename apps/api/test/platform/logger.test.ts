import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  loggerOptions,
  REDACTED,
  SENSITIVE_KEYS,
  serializeError,
} from "../../src/platform/logging/logger.js";
import { captureLogs } from "../support/logs.js";

describe("Redaction des journaux (R21)", () => {
  it("masque password, token et cookie à toutes les profondeurs (R21)", () => {
    const logs = captureLogs();
    const log = pino(loggerOptions("info"), logs.stream);
    log.info(
      {
        password: "mdp-racine",
        body: { token: "jeton-invitation", user: { password: "mdp-imbrique" } },
        headers: { cookie: "__Host-ardoiz=identifiant-de-session", authorization: "Bearer jeton-porteur" },
        deep: { a: { b: { totp: "123456" } } },
      },
      "tentative de connexion",
    );
    const text = logs.text();
    for (const secret of [
      "mdp-racine",
      "jeton-invitation",
      "mdp-imbrique",
      "identifiant-de-session",
      "jeton-porteur",
      "123456",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain(REDACTED);
    expect(text).toContain("tentative de connexion");
  });

  it("masque le contenu des réponses et des scènes du cahier (R21)", () => {
    const logs = captureLogs();
    pino(loggerOptions("info"), logs.stream).info({ attempt: { answers: ["12"], scene: { elements: [] } } });
    expect(logs.text()).not.toContain('"12"');
    expect(logs.text()).not.toContain("elements");
  });

  it("couvre au moins les champs exigés par le catalogue (R21)", () => {
    expect(SENSITIVE_KEYS).toEqual(
      expect.arrayContaining(["password", "token", "totp", "cookie", "authorization", "answers", "scene"]),
    );
  });

  it("écrit du JSON structuré horodaté (R21)", () => {
    const logs = captureLogs();
    pino(loggerOptions("info"), logs.stream).info("démarrage");
    const line = logs.lines()[0] as { time?: unknown };
    expect(line).toMatchObject({ level: 30, service: "ardoiz-api", msg: "démarrage" });
    expect(typeof line.time).toBe("string");
  });

  it("masque une adresse e-mail, y compris celle du destinataire d'un e-mail (R21)", () => {
    const logs = captureLogs();
    pino(loggerOptions("info"), logs.stream).info({ mail: { email: "awa@example.org" } }, "e-mail envoyé");
    expect(logs.text()).not.toContain("awa@example.org");
  });

  it("ne garde d'une erreur que type, message, pile, code et contrainte (R21)", () => {
    const error = Object.assign(
      new Error('duplicate key value violates unique constraint "accounts_email_key"'),
      {
        code: "23505",
        constraint: "accounts_email_key",
        detail: "Key (email)=(awa@example.org) already exists.",
        table: "accounts",
        where: "SQL statement",
      },
    );
    const logs = captureLogs();
    pino(loggerOptions("info"), logs.stream).error({ err: error }, "erreur inattendue");
    expect(logs.text()).not.toContain("awa@example.org");
    expect(logs.text()).not.toContain("SQL statement");
    expect(Object.keys(serializeError(error)).sort()).toEqual([
      "code",
      "constraint",
      "message",
      "stack",
      "type",
    ]);
  });
});
