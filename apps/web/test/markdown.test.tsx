import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "../src/markdown/Markdown";

// Sous jsdom, import.meta.url n'est pas une URL file: ; on part du dossier du test.
const LEGAL_DIR = join(import.meta.dirname, "../../../docs/juridique/");
const renderMarkdown = (source: string) =>
  render(
    <MemoryRouter>
      <Markdown source={source} />
    </MemoryRouter>,
  ).container;

afterEach(cleanup);

describe("Rendu Markdown sans HTML brut (R4, M4)", () => {
  it.each([
    ["une balise script", "<script>alert(1)</script>", "script"],
    ["une image piégée", '<img src=x onerror="alert(1)">', "img"],
    ["un iframe", '<iframe src="https://evil.example"></iframe>', "iframe"],
    ["du HTML en ligne", "Bonjour <b onmouseover=alert(1)>toi</b>", "b"],
  ])("affiche %s comme du texte, sans créer d'élément (R4)", (_label, source, tag) => {
    const container = renderMarkdown(source);
    expect(container.querySelector(tag)).toBeNull();
    expect(container.textContent).toContain("<");
  });

  it.each([
    ["javascript:", "[clic](javascript:alert(1))"],
    ["data:", "[clic](data:text/html,<script>alert(1)</script>)"],
    ["http non chiffré", "[clic](http://example.org)"],
    ["protocole relatif", "[clic](//evil.example)"],
  ])("ne crée aucun lien %s (R4)", (_label, source) => {
    const container = renderMarkdown(source);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("clic");
  });

  it("garde les liens internes et https, avec rel=noopener vers l'extérieur", () => {
    const container = renderMarkdown("[conf](/confidentialite) et [cnil](https://www.cnil.fr)");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/confidentialite",
      "https://www.cnil.fr",
    ]);
    expect(links[1]?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("rend la mise en forme des textes juridiques : gras, listes, tableaux, citations", () => {
    const container = renderMarkdown(
      "**gras**\n\n1. un\n2. deux\n\n> note\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    );
    expect(container.querySelector("strong")?.textContent).toBe("gras");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("affiche chaque texte de docs/juridique en entier, sans perdre de mot", () => {
    for (const file of readdirSync(LEGAL_DIR).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    )) {
      const source = readFileSync(`${LEGAL_DIR}${file}`, "utf8");
      const text = renderMarkdown(source).textContent;
      for (const word of source.match(/[\p{L}]{6,}/gu)?.slice(0, 80) ?? [])
        expect(text, `${file} : ${word}`).toContain(word);
      cleanup();
    }
  });
});
