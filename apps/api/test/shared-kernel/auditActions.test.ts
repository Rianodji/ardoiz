import { AUDIT_ACTIONS as PUBLISHED, AUDIT_ACTOR_KINDS } from "@ardoiz/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuditActor } from "../../src/shared-kernel/AuditTrail.js";
import { AUDIT_ACTIONS } from "../../src/shared-kernel/auditActions.js";

describe("Codes du journal d'audit (R12, L8 correction 3)", () => {
  it("la liste écrite par l'API et celle publiée à l'interface sont identiques", () => {
    expect([...PUBLISHED]).toEqual([...AUDIT_ACTIONS]);
  });

  it("la liste est sans doublon, et chaque code a la forme « module.action »", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const code of AUDIT_ACTIONS) expect(code).toMatch(/^[a-z]+\.[a-z]+(-[a-z]+)*$/);
  });

  it("le code écrit par la fonction SQL de purge figure dans la liste", () => {
    const migrations = new URL("../../../../db/migrations/", import.meta.url);
    const purge = readFileSync(new URL("013_retrait_date_par_la_base.sql", migrations), "utf8");
    const written = [...purge.matchAll(/'([a-z]+\.[a-z-]+)', 'system'/g)].map((match) => match[1]);
    expect(written).toEqual(["privacy.learner-purged"]);
    for (const code of written) expect(AUDIT_ACTIONS).toContain(code);
  });

  it("les auteurs publiés couvrent tous les auteurs possibles d'une entrée", () => {
    const kinds: ReadonlyArray<AuditActor["kind"]> = ["tutor", "guardian", "learner", "system"];
    expect([...AUDIT_ACTOR_KINDS].sort()).toEqual([...kinds].sort());
  });
});
