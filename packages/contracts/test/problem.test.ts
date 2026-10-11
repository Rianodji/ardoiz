import { describe, expect, it } from "vitest";
import { isProblemDetails } from "../src/index.js";

describe("ProblemDetails (RFC 9457)", () => {
  it("reconnaît un document d'erreur conforme", () => {
    expect(
      isProblemDetails({
        type: "about:blank",
        title: "Ressource introuvable",
        status: 404,
        code: "application.not-found",
        requestId: "req-1",
      }),
    ).toBe(true);
  });

  it.each([
    ["un champ inconnu (fuite de détail interne)", { stack: "at Object.<anonymous>" }],
    ["un statut qui n'est pas une erreur", { status: 200 }],
    ["un code mal formé", { code: "Erreur SQL : relation absente" }],
  ])("refuse un document avec %s", (_label, override) => {
    const base = { type: "about:blank", title: "Erreur", status: 500, code: "internal-error" };
    expect(isProblemDetails({ ...base, ...override })).toBe(false);
  });
});
