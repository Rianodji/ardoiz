import { validateLessonContent, type LessonContent } from "@ardoiz/content-schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LessonContentView } from "../src/lesson/LessonContentView";

afterEach(cleanup);

function content(raw: unknown): LessonContent {
  const result = validateLessonContent(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.value;
}
const doc = (...blocks: unknown[]) => content({ type: "doc", content: blocks });
const paragraph = (text: string, marks?: unknown[]) => ({
  type: "paragraph",
  content: [marks === undefined ? { type: "text", text } : { type: "text", text, marks }],
});

describe("Rendu d'un cours (R4)", () => {
  it("affiche du HTML contenu dans un texte comme du texte, sans créer d'élément (R4)", () => {
    const { container } = render(
      <LessonContentView
        content={doc(paragraph('<script>alert(1)</script><img src=x onerror="alert(1)">'))}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("rend un lien https qui s'ouvre sans lien avec la page (R4)", () => {
    const { container } = render(
      <LessonContentView
        content={doc(
          paragraph("Éduscol", [{ type: "link", attrs: { href: "https://eduscol.education.fr" } }]),
        )}
      />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://eduscol.education.fr/");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("rend les formules en MathML, sans aucun attribut style (compatible avec la CSP, ADR-0011)", () => {
    const { container } = render(
      <LessonContentView
        content={doc(
          { type: "paragraph", content: [{ type: "math_inline", attrs: { latex: "\\frac{1}{2}" } }] },
          { type: "math_block", attrs: { latex: "\\sqrt{x^2 + 1}" } },
        )}
      />,
    );
    expect(container.querySelectorAll("math")).toHaveLength(2);
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector("script, a, img")).toBeNull();
  });

  it("sert les images par la route autorisée des médias, avec leur texte alternatif (R3, R14)", () => {
    const { container } = render(
      <LessonContentView
        content={doc({
          type: "image",
          attrs: { mediaId: "med_01920000-0000-7000-8000-000000000001", alt: "Une règle" },
        })}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/media/med_01920000-0000-7000-8000-000000000001",
    );
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Une règle");
  });

  it("rend encadrés, tableaux, listes et code avec des composants", () => {
    const { container } = render(
      <LessonContentView
        content={doc(
          { type: "callout", attrs: { kind: "astuce" }, content: [paragraph("Retiens")] },
          {
            type: "table",
            content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph("km")] }] }],
          },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [{ type: "listItem", content: [paragraph("trois")] }],
          },
          { type: "codeBlock", content: [{ type: "text", text: "<b>pas du HTML</b>" }] },
        )}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Astuce" })).toBeDefined();
    expect(container.querySelector("td")?.textContent).toBe("km");
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(container.querySelector("pre code")?.textContent).toBe("<b>pas du HTML</b>");
    expect(container.querySelector("pre b")).toBeNull();
  });
});

describe("Vidéo YouTube après un clic (R13, M12)", () => {
  it("n'insère aucun iframe ni aucune ressource YouTube avant le clic ; après, le lecteur nocookie sans suggestions (R13)", () => {
    const { container } = render(
      <LessonContentView content={doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } })} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    // Aucune ressource externe : ni src, ni href, ni image de vignette venant de Google.
    const sources = [...container.querySelectorAll("[src], [href], [srcset]")].flatMap((element) =>
      ["src", "href", "srcset"].map((name) => element.getAttribute(name) ?? ""),
    );
    expect(sources.filter((source) => /youtube|ytimg|google/i.test(source))).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Voir la vidéo/ }));
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1",
    );
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
  });
});
