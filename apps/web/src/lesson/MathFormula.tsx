import { renderLatexToMathml } from "@ardoiz/content-schema";

/**
 * Seul composant autorisé à insérer du balisage (ADR-0005, règle 6 du prompt) : le MathML produit par
 * KaTeX (`trust: false`, `strict`, bornes de taille), à partir d'une formule déjà validée. Rendu MathML :
 * aucun style en ligne, donc aucune ouverture de `style-src` (ADR-0011 proposée). Une formule refusée
 * s'affiche comme son texte source, sans balisage.
 */
export function MathFormula({ latex, display }: { readonly latex: string; readonly display: boolean }) {
  const mathml = renderLatexToMathml(latex, display);
  if (mathml === null) return <code className="math-error">{latex}</code>;
  const Tag = display ? "div" : "span";
  return (
    <Tag className={display ? "math math-block" : "math"} dangerouslySetInnerHTML={{ __html: mathml }} />
  );
}
