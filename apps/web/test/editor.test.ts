import { validateLessonContent } from "@ardoiz/content-schema";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { EDITOR_EXTENSIONS } from "../src/editor/extensions";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
});

const create = (content: unknown) => {
  editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: content as never });
  return editor;
};

describe("Éditeur de cours restreint (ADR-0005, R4)", () => {
  it("tout ce que l'éditeur produit est accepté par le validateur du schéma fermé", () => {
    const e = create({ type: "doc", content: [{ type: "paragraph" }] });
    e.chain()
      .focus()
      .insertContent([
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Les fractions" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Un demi : " },
            { type: "math_inline", attrs: { latex: "\\frac{1}{2}" } },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "un" }] }] },
          ],
        },
        { type: "math_block", attrs: { latex: "1 + 1 = 2" } },
        { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } },
        {
          type: "callout",
          attrs: { kind: "astuce" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Retiens" }] }],
        },
        { type: "image", attrs: { mediaId: "med_01920000-0000-7000-8000-000000000001", alt: "Une règle" } },
        { type: "codeBlock", content: [{ type: "text", text: "répéter 4 fois" }] },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "citation" }] }],
        },
        { type: "horizontalRule" },
      ])
      .insertTable({ rows: 2, cols: 2, withHeaderRow: false })
      .run();
    e.chain()
      .insertContent({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "lien",
            marks: [
              { type: "link", attrs: { href: "https://eduscol.education.fr/" } },
              { type: "bold" },
              { type: "underline" },
            ],
          },
        ],
      })
      .run();
    const result = validateLessonContent(e.getJSON());
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it("le schéma de l'éditeur ne connaît ni cellule d'en-tête, ni barré, ni HTML libre", () => {
    const e = create({ type: "doc", content: [{ type: "paragraph" }] });
    const nodes = Object.keys(e.schema.nodes);
    const marks = Object.keys(e.schema.marks);
    expect(nodes).not.toContain("tableHeader");
    expect(marks).not.toContain("strike");
    expect(marks.sort()).toEqual(["bold", "code", "italic", "link", "underline"]);
    for (const node of nodes) {
      expect([
        "doc",
        "paragraph",
        "text",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "hardBreak",
        "table",
        "tableRow",
        "tableCell",
        "image",
        "math_inline",
        "math_block",
        "youtube",
        "callout",
      ]).toContain(node);
    }
  });

  it("un HTML collé est réduit au schéma : ni script, ni attribut d'événement, ni lien javascript: (R4)", () => {
    const e = create({ type: "doc", content: [{ type: "paragraph" }] });
    e.commands.insertContent(
      '<p onclick="alert(1)">texte <a href="javascript:alert(1)">piège</a><script>alert(2)</script></p><iframe src="https://evil.example"></iframe>',
    );
    const json = JSON.stringify(e.getJSON());
    expect(json).not.toContain("onclick");
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("iframe");
    expect(json).not.toContain("alert(2)");
    expect(validateLessonContent(e.getJSON())).toMatchObject({ ok: true });
  });
});
