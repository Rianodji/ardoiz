import { describe, expect, it } from "vitest";
import { mediaIdsOf, validateLessonContent, youtubeEmbedUrl, youtubeIdFrom } from "../src/index.js";

const MEDIA = "med_01920000-0000-7000-8000-000000000001";
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("Schéma fermé du contenu de cours (ADR-0005, R4)", () => {
  it("accepte un cours complet, tel que l'éditeur TipTap le produit", () => {
    const tiptap = doc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Convertir des longueurs" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Un " },
          { type: "text", text: "mètre", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "text", text: " vaut " },
          { type: "math_inline", attrs: { latex: "10^2" } },
          { type: "text", text: " cm. " },
          {
            type: "text",
            text: "Voir le site",
            marks: [
              {
                type: "link",
                attrs: {
                  href: "https://eduscol.education.fr/",
                  target: "_blank",
                  rel: "noopener noreferrer nofollow",
                  class: null,
                },
              },
            ],
          },
          { type: "hardBreak" },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [p("km"), p("hm")] }] },
      {
        type: "orderedList",
        attrs: { start: 1, type: null },
        content: [{ type: "listItem", content: [p("un")] }],
      },
      { type: "blockquote", content: [p("citation")] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "si x > 3 alors" }] },
      { type: "horizontalRule" },
      { type: "image", attrs: { mediaId: MEDIA, alt: "Une règle graduée" } },
      { type: "math_block", attrs: { latex: "\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}" } },
      { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
      { type: "callout", attrs: { kind: "astuce" }, content: [p("Retiens : 1 m = 100 cm.")] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p("km")] },
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p("m")] },
            ],
          },
        ],
      },
    );
    const result = validateLessonContent(tiptap);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(mediaIdsOf(result.value)).toEqual([MEDIA]);
  });

  it("normalise : la sortie est une copie construite champ par champ, sans attribut inconnu", () => {
    const result = validateLessonContent(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "lien",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.org", target: "_blank", rel: null, class: null },
              },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: doc({
        type: "paragraph",
        content: [
          { type: "text", text: "lien", marks: [{ type: "link", attrs: { href: "https://example.org/" } }] },
        ],
      }),
    });
  });

  it("refuse un document vide, et donne le chemin du problème sans la valeur reçue", () => {
    expect(validateLessonContent(doc())).toEqual({
      ok: false,
      problems: [{ path: "$.content", code: "empty-content" }],
    });
    expect(validateLessonContent(doc(p("ok"), { type: "script" }))).toEqual({
      ok: false,
      problems: [{ path: "$.content[1].type", code: "unknown-node" }],
    });
  });

  it("borne la taille : trop de nœuds, trop de profondeur, texte trop long (R15)", () => {
    const many = doc(...Array.from({ length: 5_001 }, () => ({ type: "horizontalRule" })));
    expect(validateLessonContent(many)).toMatchObject({ ok: false, problems: [{ code: "too-many-nodes" }] });
    let deep: unknown = p("fond");
    for (let i = 0; i < 20; i++) deep = { type: "blockquote", content: [deep] };
    expect(validateLessonContent(doc(deep))).toMatchObject({
      ok: false,
      problems: [{ code: "document-too-deep" }],
    });
    expect(validateLessonContent(doc(p("x".repeat(10_001))))).toMatchObject({
      ok: false,
      problems: [{ code: "invalid-text" }],
    });
  });
});

describe("Vidéos YouTube (R13)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://evil.example/watch?v=dQw4w9WgXcQ", null],
    ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", null],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ%22onload", null],
  ])("extrait l'identifiant de %s", (input, expected) => {
    expect(youtubeIdFrom(input)).toBe(expected);
  });

  it("construit toujours le lecteur sur youtube-nocookie.com, sans suggestions (rel=0)", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1",
    );
    expect(youtubeEmbedUrl("../../evil")).toBeNull();
  });
});
