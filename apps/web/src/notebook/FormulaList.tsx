import { checkLatex } from "@ardoiz/content-schema";
import { useId, useState } from "react";
import { describeLatexProblem } from "../editor/FormulaDialog";
import { MathFormula } from "../lesson/MathFormula";

export interface NotebookFormula {
  readonly id: string;
  readonly latex: string;
}

/**
 * Formules du cahier (ADR-0012 proposée) : saisie LaTeX aidée par une palette, aperçu en MathML
 * (KaTeX, ADR-0011), mêmes règles que l'API (`checkLatex`). MathLive n'est pas utilisé : son rendu
 * pose des styles en ligne que la CSP de production refuse.
 */
const PALETTE: ReadonlyArray<{ readonly label: string; readonly insert: string; readonly title: string }> = [
  { label: "a⁄b", insert: "\\frac{}{}", title: "Fraction" },
  { label: "x²", insert: "^{2}", title: "Au carré" },
  { label: "xⁿ", insert: "^{}", title: "Puissance" },
  { label: "√", insert: "\\sqrt{}", title: "Racine carrée" },
  { label: "×", insert: "\\times ", title: "Multiplié par" },
  { label: "÷", insert: "\\div ", title: "Divisé par" },
  { label: "π", insert: "\\pi ", title: "Pi" },
  { label: "°", insert: "^{\\circ}", title: "Degré" },
  { label: "≈", insert: "\\approx ", title: "Environ égal" },
  { label: "≤", insert: "\\leq ", title: "Inférieur ou égal" },
  { label: "≥", insert: "\\geq ", title: "Supérieur ou égal" },
  { label: "texte", insert: "\\text{}", title: "Mot avec accents, par exemple une unité" },
];

const MAX_FORMULAS = 50;

export function FormulaList({
  formulas,
  readOnly,
  onChange,
}: {
  readonly formulas: readonly NotebookFormula[];
  readonly readOnly: boolean;
  readonly onChange?: (formulas: NotebookFormula[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();

  if (readOnly) {
    return formulas.length === 0 ? null : (
      <ul className="formula-list" aria-label="Formules">
        {formulas.map((formula) => (
          <li key={formula.id}>
            <MathFormula latex={formula.latex} display />
          </li>
        ))}
      </ul>
    );
  }

  const add = () => {
    const found = checkLatex(draft, true);
    if (found !== null) {
      setProblem(describeLatexProblem(found));
      return;
    }
    setProblem(null);
    onChange?.([...formulas, { id: `f${Date.now().toString(36)}`, latex: draft }]);
    setDraft("");
  };

  return (
    <div className="formula-list">
      <ul aria-label="Formules">
        {formulas.map((formula) => (
          <li key={formula.id} className="lesson-row">
            <MathFormula latex={formula.latex} display />
            <button
              type="button"
              className="button secondary"
              onClick={() => onChange?.(formulas.filter((other) => other.id !== formula.id))}
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>
      {formulas.length < MAX_FORMULAS && (
        <div className="stack">
          <div className="toolbar" role="toolbar" aria-label="Symboles">
            {PALETTE.map((item) => (
              <button
                key={item.title}
                type="button"
                className="tool"
                title={item.title}
                aria-label={item.title}
                onClick={() => {
                  setDraft(`${draft}${item.insert}`);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label htmlFor={inputId}>Écris une formule</label>
          <input
            id={inputId}
            value={draft}
            maxLength={1000}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          {draft.trim() !== "" && checkLatex(draft, true) === null && (
            <div aria-label="Aperçu de la formule">
              <MathFormula latex={draft} display />
            </div>
          )}
          {problem !== null && <p role="alert">{problem}</p>}
          <button type="button" className="button secondary" disabled={draft.trim() === ""} onClick={add}>
            Ajouter la formule
          </button>
        </div>
      )}
    </div>
  );
}
