import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/markdown/Markdown";
import { json, problem, renderAt, stubServer } from "./support";

const LEGAL_DIR = join(import.meta.dirname, "../../../docs/juridique/");
const legal = (file: string) => readFileSync(`${LEGAL_DIR}${file}`, "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const levels = () =>
  [...document.querySelectorAll("h1, h2, h3, h4")].map(
    (heading) => `${heading.tagName} ${heading.textContent}`,
  );

describe("Pages juridiques : un seul titre (verdict L8, S-8)", () => {
  it.each([
    ["/mentions-legales", "mentions-legales", "mentions-legales.md", "Mentions légales"],
    [
      "/confidentialite",
      "confidentialite",
      "politique-de-confidentialite.md",
      "Politique de confidentialité",
    ],
  ])(
    "%s : le premier titre du document est le h1 de la page, et le seul",
    async (path, document, file, title) => {
      stubServer((url) => {
        if (url === "/api/me") return problem(401, "http.unauthenticated");
        if (url === `/api/legal/${document}`)
          return json(200, { document, markdown: legal(file), version: "v2", sha256: "0".repeat(64) });
        return undefined;
      });
      renderAt(path);
      // Les sections du texte, au niveau 2 : le document est chargé.
      expect((await screen.findAllByRole("heading", { level: 2 })).length).toBeGreaterThan(2);
      expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual([
        title,
      ]);
    },
  );

  it("/mes-donnees : le titre du texte de l'élève remplace « Mes données »", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "learner", id: "lrn_1", name: "Lina", mfaEnrolled: false });
      if (url === "/api/legal/confidentialite-eleve")
        return json(200, {
          document: "confidentialite-eleve",
          markdown: legal("confidentialite-version-eleve.md"),
          version: "v2",
          sha256: "0".repeat(64),
        });
      return undefined;
    });
    renderAt("/mes-donnees");
    await screen.findByRole("heading", { name: "Ce qu'Ardoiz sait de toi", level: 2 });
    const titles = screen.getAllByRole("heading", { level: 1 });
    expect(titles.map((heading) => heading.textContent)).toEqual([
      "Tes données sur Ardoiz, expliquées simplement",
    ]);
    expect(screen.queryByRole("heading", { name: "Mes données" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Ce qu'Ardoiz sait de toi", level: 2 })).toBeDefined();
  });

  it("un texte sans titre « # » garde le nom de la page en h1, sans décaler les niveaux", () => {
    render(
      <MemoryRouter>
        <Markdown source={"Préambule.\n\n## Section"} pageTitle="Mentions légales" />
      </MemoryRouter>,
    );
    expect(levels()).toEqual(["H1 Mentions légales", "H2 Section"]);
  });

  it("inséré dans une page qui a son titre, un texte garde ses niveaux décalés d'un cran", () => {
    render(
      <MemoryRouter>
        <Markdown source={"# Accord\n\n## Détail"} />
      </MemoryRouter>,
    );
    expect(levels()).toEqual(["H2 Accord", "H3 Détail"]);
  });
});

describe("Tableaux des textes juridiques (verdict L8, S-9)", () => {
  it("chaque tableau défile dans une boîte focalisable, nommée par sa section", () => {
    render(
      <MemoryRouter>
        <Markdown
          source={legal("politique-de-confidentialite.md")}
          pageTitle="Politique de confidentialité"
        />
      </MemoryRouter>,
    );
    const boxes = screen.getAllByRole("region");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Tableau : 2. Quelles données, pourquoi, sur quelle base ?",
      "Tableau : 3. Qui voit ces données ?",
      "Tableau : 4. Combien de temps ?",
    ]);
    for (const box of boxes) {
      expect(box.className).toBe("table-box");
      expect(box.tabIndex).toBe(0);
      expect(within(box).getAllByRole("columnheader").length).toBeGreaterThan(1);
    }
  });

  it("deux tableaux d'une même section ont des noms distincts", () => {
    render(
      <MemoryRouter>
        <Markdown source={"## Durées\n\n| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |"} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("region").map((box) => box.getAttribute("aria-label"))).toEqual([
      "Tableau : Durées",
      "Tableau : Durées (2)",
    ]);
  });
});
