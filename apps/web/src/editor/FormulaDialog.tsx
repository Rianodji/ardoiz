import { checkLatex, type LatexProblem } from "@ardoiz/content-schema";
import { useId, useState } from "react";

/** Explication en français d'une formule refusée, pour le tuteur (verdict L2, S-2). */
export function describeLatexProblem(problem: LatexProblem): string {
  switch (problem) {
    case "latex-invalid":
      return "Cette formule n'est pas du LaTeX valide. Les mots avec accents se mettent dans \\text{…}, par exemple \\text{mètre}.";
    case "latex-forbidden-command":
      return "Cette formule utilise une commande interdite dans un cours (lien, image, style ou macro).";
    case "latex-styled":
      return "Cette commande de mise en forme (cadre, couleur de fond, taille d'affichage) n'est pas disponible : écris la formule sans elle.";
    case "latex-too-long":
      return "Cette formule est vide ou trop longue (1 000 caractères au plus).";
  }
}

/**
 * Saisie d'une formule dans l'éditeur : elle est vérifiée avec les MÊMES règles que l'API
 * (`checkLatex`), et une formule refusée est expliquée au lieu d'être insérée.
 */
export function FormulaDialog({
  display,
  onInsert,
  onCancel,
}: {
  readonly display: boolean;
  readonly onInsert: (latex: string) => void;
  readonly onCancel: () => void;
}) {
  const [latex, setLatex] = useState("");
  const [problem, setProblem] = useState<LatexProblem | null>(null);
  const inputId = useId();
  return (
    <form
      className="formula-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        const found = checkLatex(latex, display);
        setProblem(found);
        if (found === null) onInsert(latex);
      }}
    >
      <label htmlFor={inputId}>
        {display ? "Formule centrée (LaTeX)" : "Formule (LaTeX), par exemple \\frac{1}{2}"}
      </label>
      <input
        id={inputId}
        value={latex}
        autoFocus
        onChange={(event) => {
          setLatex(event.target.value);
          setProblem(null);
        }}
      />
      {problem !== null && (
        <p role="alert" className="error">
          {describeLatexProblem(problem)}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button">
          Insérer
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
