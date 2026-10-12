import { describe, expect, it } from "vitest";
import { validateLessonContent } from "../src/index.js";

const MEDIA = "med_01920000-0000-7000-8000-000000000001";
const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: unknown[]) =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks };
const link = (href: string) => p(text("clic", [{ type: "link", attrs: { href } }]));
const math = (latex: string) => doc({ type: "math_block", attrs: { latex } });
const inlineMath = (latex: string) => doc(p({ type: "math_inline", attrs: { latex } }));

/**
 * Corpus de charges hostiles (R4, M4) : chacune doit être REFUSÉE par le validateur, avec un code
 * d'erreur précis. Le texte qui contient du HTML est, lui, accepté comme texte et rendu inoffensif
 * par React (voir le test du rendu côté web).
 */
const CORPUS: ReadonlyArray<readonly [string, unknown, string]> = [
  // Balises et nœuds inconnus
  ["nœud script", doc({ type: "script", content: [text("alert(1)")] }), "unknown-node"],
  ["nœud iframe", doc({ type: "iframe", attrs: { src: "https://evil.example" } }), "unknown-node"],
  ["nœud html brut", doc({ type: "html", attrs: { html: "<img src=x onerror=alert(1)>" } }), "unknown-node"],
  ["nœud svg", doc({ type: "svg", content: [] }), "unknown-node"],
  ["nœud object/embed", doc({ type: "embed", attrs: { src: "evil.swf" } }), "unknown-node"],
  [
    "en-tête de tableau (hors liste blanche)",
    doc({
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(text("x"))] }] }],
    }),
    "unknown-node",
  ],
  // Attributs d'événement, style, classe
  [
    "attribut onclick",
    doc({ type: "paragraph", attrs: { onclick: "alert(1)" }, content: [text("x")] }),
    "unknown-key",
  ],
  [
    "attribut style sur un titre",
    doc({
      type: "heading",
      attrs: { level: 1, style: "background:url(javascript:alert(1))" },
      content: [text("x")],
    }),
    "unknown-attribute",
  ],
  [
    "attribut class sur un lien",
    doc(p(text("x", [{ type: "link", attrs: { href: "https://ok.example", class: "pwn" } }]))),
    "invalid-attribute",
  ],
  [
    "attribut onerror sur une image",
    doc({ type: "image", attrs: { mediaId: MEDIA, alt: "x", onerror: "alert(1)" } }),
    "unknown-attribute",
  ],
  [
    "clé inconnue __proto__",
    JSON.parse('{"type":"doc","content":[{"type":"paragraph","__proto__":{"polluted":true}}]}'),
    "unknown-key",
  ],
  ["clé inconnue html sur un texte", doc(p({ type: "text", text: "x", html: "<b>x</b>" })), "unknown-key"],
  // Liens dangereux
  ["lien javascript:", doc(link("javascript:alert(1)")), "invalid-link"],
  ["lien JaVaScRiPt: en casse mixte", doc(link("JaVaScRiPt:alert(1)")), "invalid-link"],
  ["lien javascript: avec tabulation", doc(link("java\tscript:alert(1)")), "invalid-link"],
  ["lien data:", doc(link("data:text/html,<script>alert(1)</script>")), "invalid-link"],
  ["lien vbscript:", doc(link("vbscript:msgbox(1)")), "invalid-link"],
  ["lien http non chiffré", doc(link("http://example.org")), "invalid-link"],
  ["lien relatif au protocole", doc(link("//evil.example/x")), "invalid-link"],
  ["lien avec identifiants", doc(link("https://admin:secret@evil.example")), "invalid-link"],
  ["lien avec entité HTML", doc(link("javascript&#58;alert(1)")), "invalid-link"],
  ["lien avec espace initial", doc(link(" https://example.org")), "invalid-link"],
  // Marques inconnues
  ["marque script", doc(p(text("x", [{ type: "script" }]))), "unknown-mark"],
  ["marque style", doc(p(text("x", [{ type: "textStyle", attrs: { color: "red" } }]))), "unknown-mark"],
  // LaTeX
  ["LaTeX \\href", math("\\href{javascript:alert(1)}{clic}"), "latex-forbidden-command"],
  ["LaTeX \\url", math("\\url{javascript:alert(1)}"), "latex-forbidden-command"],
  ["LaTeX \\htmlClass", math("\\htmlClass{pwn}{x}"), "latex-forbidden-command"],
  ["LaTeX \\htmlStyle", inlineMath("\\htmlStyle{background:red}{x}"), "latex-forbidden-command"],
  ["LaTeX \\htmlId", math("\\htmlId{root}{x}"), "latex-forbidden-command"],
  ["LaTeX \\htmlData", math("\\htmlData{x=1}{y}"), "latex-forbidden-command"],
  [
    "LaTeX \\includegraphics",
    math("\\includegraphics{https://evil.example/x.png}"),
    "latex-forbidden-command",
  ],
  ["LaTeX bombe de macros \\def", math("\\def\\a{\\a\\a}\\a"), "latex-forbidden-command"],
  ["LaTeX invalide", math("\\frac{1}{"), "latex-invalid"],
  ["LaTeX trop long", math("x+".repeat(600)), "latex-too-long"],
  // Identifiants forgés
  [
    "vidéo : identifiant avec guillemet",
    doc({ type: "youtube", attrs: { videoId: 'dQw4w9WgX"Q' } }),
    "invalid-video-id",
  ],
  [
    "vidéo : paramètres ajoutés",
    doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ?autoplay=1" } }),
    "invalid-video-id",
  ],
  ["vidéo : chemin relatif", doc({ type: "youtube", attrs: { videoId: "../../../x" } }), "invalid-video-id"],
  [
    "vidéo : URL complète",
    doc({ type: "youtube", attrs: { videoId: "https://evil.example/embed" } }),
    "invalid-video-id",
  ],
  [
    "image : chemin du serveur",
    doc({ type: "image", attrs: { mediaId: "../../etc/passwd", alt: "x" } }),
    "invalid-media-id",
  ],
  [
    "image : URL externe",
    doc({ type: "image", attrs: { mediaId: "https://evil.example/x.png", alt: "x" } }),
    "invalid-media-id",
  ],
  [
    "image : src au lieu d'un média",
    doc({ type: "image", attrs: { src: "javascript:alert(1)", alt: "x" } }),
    "unknown-attribute",
  ],
  // Divers
  [
    "titre de niveau 7",
    doc({ type: "heading", attrs: { level: 7 }, content: [text("x")] }),
    "invalid-heading-level",
  ],
  [
    "encadré de type inconnu",
    doc({ type: "callout", attrs: { kind: "<script>" }, content: [p(text("x"))] }),
    "invalid-callout-kind",
  ],
  [
    "langage de code injecté",
    doc({ type: "codeBlock", attrs: { language: 'js" onload="alert(1)' }, content: [text("x")] }),
    "invalid-attribute",
  ],
  ["texte avec inversion bidirectionnelle", doc(p(text("admin\u202Egnp.exe"))), "forbidden-character"],
  ["texte avec octet nul", doc(p(text("x\u0000y"))), "forbidden-character"],
];

describe("Corpus XSS : tout document hostile est refusé à l'écriture (R4, M4)", () => {
  it("compte au moins 30 charges", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(CORPUS)("refuse %s (R4)", (_label, payload, code) => {
    const result = validateLessonContent(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.code).toBe(code);
  });

  it("accepte du HTML dans un TEXTE : c'est du texte, rendu inoffensif par React (R4)", () => {
    const result = validateLessonContent(
      doc(p(text('<script>alert(1)</script><img src=x onerror="alert(1)">'))),
    );
    expect(result.ok).toBe(true);
  });
});
