import { AUDIT_ACTIONS, AUDIT_ACTOR_KINDS } from "@ardoiz/contracts";
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_LABELS,
  auditActionLabel,
  auditActorLabel,
} from "../src/pages/auditLabels";

/** Même principe que le test des gabarits d'e-mail : un code sans libellé fait échouer la suite. */
describe("Libellés du journal d'audit (L8, correction 3)", () => {
  it.each([...AUDIT_ACTIONS])("le code %s a un libellé français, jamais le code lui-même", (code) => {
    const label = AUDIT_ACTION_LABELS[code];
    expect(label.trim()).not.toBe("");
    expect(label).not.toContain(code);
    expect(label).not.toMatch(/[a-z]+\.[a-z-]+/);
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
  });

  it("aucun libellé n'existe pour un code absent de la liste fermée", () => {
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it.each([...AUDIT_ACTOR_KINDS])("l'auteur %s a un libellé français", (kind) => {
    expect(AUDIT_ACTOR_LABELS[kind]).toMatch(/^[A-ZÉ][a-zéè]+$/);
  });

  it("un code ou un auteur inconnu n'est jamais affiché tel quel", () => {
    expect(auditActionLabel("access.denied")).toBe("Action non répertoriée");
    expect(auditActorLabel("guardian")).toBe("Parent");
    expect(auditActorLabel("robot")).toBe("Inconnu");
  });
});
