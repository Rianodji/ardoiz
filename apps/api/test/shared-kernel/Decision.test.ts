import { describe, expect, it } from "vitest";
import { allow, deny, enforce, hide, type Decision } from "../../src/shared-kernel/Decision.js";
import { ForbiddenError, NotFoundError } from "../../src/shared-kernel/DomainError.js";

describe("Décision d'une politique d'accès (ADR-0010)", () => {
  it("laisse passer une décision « allow »", () => {
    expect(() => {
      enforce(allow());
    }).not.toThrow();
  });

  it("transforme « deny » en refus visible (403)", () => {
    expect(() => {
      enforce(deny("tutor-only"));
    }).toThrow(ForbiddenError);
  });

  it("transforme « hide » en ressource introuvable, comme une ressource inexistante (R2)", () => {
    expect(() => {
      enforce(hide());
    }).toThrow(NotFoundError);
  });

  it("refuse une décision inconnue au lieu de l'autoriser par défaut (R18)", () => {
    const forged = JSON.parse('{"kind":"allow-all"}') as Decision;
    expect(() => {
      enforce(forged);
    }).toThrow();
  });
});
