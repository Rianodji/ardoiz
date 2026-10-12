import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormulaDialog } from "../src/editor/FormulaDialog";

afterEach(cleanup);

describe("Saisie d'une formule dans l'éditeur (verdict L2, S-2)", () => {
  const setup = () => {
    const inserted: string[] = [];
    render(
      <FormulaDialog display={false} onInsert={(latex) => inserted.push(latex)} onCancel={() => undefined} />,
    );
    const type = (latex: string) => {
      fireEvent.change(screen.getByLabelText(/Formule/), { target: { value: latex } });
      fireEvent.click(screen.getByRole("button", { name: "Insérer" }));
    };
    return { inserted, type };
  };

  it("explique en français qu'un mot accentué se met dans \\text{…}, au lieu d'insérer la formule", () => {
    const { inserted, type } = setup();
    type("aire = 3 mètres");
    expect(screen.getByRole("alert").textContent).toBe(
      "Cette formule n'est pas du LaTeX valide. Les mots avec accents se mettent dans \\text{…}, par exemple \\text{mètre}.",
    );
    expect(inserted).toEqual([]);
  });

  it("explique le refus d'une commande interdite, \\fcolorbox comprise (S-1)", () => {
    const { inserted, type } = setup();
    type("\\fcolorbox{red}{blue}{a}");
    expect(screen.getByRole("alert").textContent).toContain("interdite");
    type("\\href{https://evil.example}{a}");
    expect(screen.getByRole("alert").textContent).toContain("interdite");
    expect(inserted).toEqual([]);
  });

  it("insère une formule valide, accent compris dans \\text{…}", () => {
    const { inserted, type } = setup();
    type("\\text{aire} = 3\\,\\text{mètres}");
    expect(inserted).toEqual(["\\text{aire} = 3\\,\\text{mètres}"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
