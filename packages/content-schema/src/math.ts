import katex from "katex";

/**
 * Réglages KaTeX communs à la validation (API) et au rendu (front) : aucune commande « de confiance »
 * (`\href`, `\url`, `\htmlClass`…), bornes de taille et d'expansion, rendu MathML (sans style en ligne,
 * donc sans ouvrir `style-src`, ADR-0011 proposée). R4, M4.
 */
export const KATEX_OPTIONS = {
  trust: false,
  strict: "error",
  maxSize: 10,
  maxExpand: 200,
  output: "mathml",
  throwOnError: true,
} as const;

export const MAX_LATEX_LENGTH = 1_000;

/**
 * Commandes refusées à l'écriture, même si `trust: false` les neutraliserait au rendu : liens,
 * classes et styles HTML, images externes, définitions de macros (bombes d'expansion).
 */
const FORBIDDEN_COMMANDS =
  /\\(href|url|htmlClass|htmlId|htmlStyle|htmlData|includegraphics|class|cssId|style|def|gdef|edef|xdef|let|newcommand|renewcommand|providecommand|expandafter|csname|futurelet|global)(?![a-zA-Z])/;

export type LatexProblem = "latex-too-long" | "latex-forbidden-command" | "latex-invalid";

/** Vérifie une formule : longueur, commandes interdites, puis analyse stricte par KaTeX. */
export function checkLatex(latex: string, displayMode: boolean): LatexProblem | null {
  if (latex.length === 0 || latex.length > MAX_LATEX_LENGTH) return "latex-too-long";
  if (FORBIDDEN_COMMANDS.test(latex)) return "latex-forbidden-command";
  try {
    katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
    return null;
  } catch {
    return "latex-invalid"; // la formule est refusée, l'erreur de KaTeX n'est pas propagée
  }
}

/** Rendu MathML d'une formule déjà validée ; une formule invalide est rendue comme son texte source. */
export function renderLatexToMathml(latex: string, displayMode: boolean): string | null {
  if (checkLatex(latex, displayMode) !== null) return null;
  return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
}
