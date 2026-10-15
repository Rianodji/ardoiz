import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Menu de l'élève (charte §6, verdict L8 S-4)", () => {
  it("chaque entrée a une icône et un mot, « Moi » compris", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "learner", id: "lrn_1", name: "Lina", mfaEnrolled: false });
      if (url === "/api/auth/sessions") return json(200, { sessions: [] });
      return undefined;
    });
    renderAt("/compte");
    await screen.findByRole("link", { name: "Accueil" });
    const menu = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((link) => link.textContent.trim())).toEqual([
      "Accueil",
      "Mes cours",
      "Mes devoirs",
      "Mes progrès",
      "Moi",
    ]);
    for (const link of links) {
      const icon = link.querySelector("svg.icon");
      expect(icon, link.textContent).not.toBeNull();
      // L'icône accompagne le mot : elle est cachée aux lecteurs d'écran.
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
