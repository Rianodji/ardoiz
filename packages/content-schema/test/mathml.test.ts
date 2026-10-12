import { describe, expect, it } from "vitest";
import { checkLatex, renderLatexToMathml } from "../src/index.js";

/**
 * Corpus de formules : celles d'un cours de collège, et toutes les commandes KaTeX qui touchent à la
 * présentation (couleur, cadre, espacement, taille, style). CHAQUE formule acceptée est rendue, et son
 * MathML ne doit porter aucun attribut `style` (ADR-0011, verdict L2 S-1).
 */
const CORPUS = [
  "10^2",
  "\\frac{1}{2}",
  "\\frac{1}{2} + \\frac{1}{4} = \\frac{3}{4}",
  "1 + 1 = 2",
  "\\sqrt{x^2 + 1}",
  "3{,}5 \\times 10^{-2}",
  "x_1, x_2",
  "a \\div b",
  "\\pi r^2",
  "\\widehat{ABC} = 90^\\circ",
  "(AB) \\perp (CD)",
  "(AB) \\parallel (CD)",
  "\\text{aire} = L \\times \\ell",
  "\\text{mètre}",
  "1\\,\\text{km} = 1\\,000\\,\\text{m}",
  "\\overline{AB}",
  "\\vec{u}",
  "\\sum_{i=1}^{n} i",
  "\\left( \\frac{a}{b} \\right)^2",
  "\\begin{cases} x & \\text{si } x > 0 \\\\ -x & \\text{sinon} \\end{cases}",
  "\\color{red}{a}",
  "\\textcolor{red}{a}",
  "\\colorbox{red}{a}",
  "\\fcolorbox{red}{blue}{a}",
  "\\boxed{a}",
  "\\fbox{a}",
  "\\raisebox{1em}{a}",
  "\\rule{1em}{2em}",
  "\\kern{1em}",
  "\\mkern3mu",
  "\\hspace{1em}",
  "\\hskip{1em}",
  "\\phantom{a}",
  "\\vphantom{a}",
  "\\smash{a}",
  "\\llap{a}",
  "\\mathrlap{a}",
  "\\cancel{a}",
  "\\bcancel{a}",
  "\\xcancel{a}",
  "\\angl{n}",
  "\\displaystyle a",
  "\\textstyle a",
  "\\scriptstyle a",
  "\\scriptscriptstyle a",
  "\\Huge a",
  "\\tiny a",
  "\\underline{a}",
  "\\overbrace{a}^b",
  "\\underbrace{a}_b",
  "\\bbox{a}",
  "\\mathbf{v}",
  "\\mathrm{cm}^2",
  "\\operatorname{pgcd}(12, 18)",
];

describe("Formules en MathML sans aucun style en ligne (ADR-0011, S-1)", () => {
  it("refuse \\fcolorbox, qui produirait un attribut style (S-1)", () => {
    expect(checkLatex("\\fcolorbox{red}{blue}{a}", false)).toBe("latex-forbidden-command");
  });

  it.each(CORPUS.flatMap((latex) => [[latex, false] as const, [latex, true] as const]))(
    "« %s » (bloc : %s) est refusée, ou rendue sans attribut style",
    (latex, display) => {
      const problem = checkLatex(latex, display);
      if (problem !== null) {
        expect(renderLatexToMathml(latex, display)).toBeNull();
        return;
      }
      const mathml = renderLatexToMathml(latex, display);
      expect(mathml).not.toBeNull();
      expect(mathml).not.toMatch(/\sstyle\s*=/i);
    },
  );

  it("les formules utiles au collège restent acceptées", () => {
    for (const latex of [
      "\\frac{1}{2}",
      "\\sqrt{x^2 + 1}",
      "\\text{mètre}",
      "\\widehat{ABC} = 90^\\circ",
      "\\color{red}{a}",
    ]) {
      expect(checkLatex(latex, false)).toBeNull();
    }
  });
});
