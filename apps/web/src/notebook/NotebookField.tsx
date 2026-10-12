import { lazy, Suspense } from "react";
import { FormulaList, type NotebookFormula } from "./FormulaList";
import type { NotebookMode } from "./NotebookCanvas";

/** Excalidraw n'est chargé que lorsqu'une question de cahier s'affiche (ADR-0004). */
const NotebookCanvas = lazy(() => import("./NotebookCanvas"));

export interface NotebookValue {
  readonly elements: readonly unknown[];
  readonly formulas: readonly NotebookFormula[];
}

/** Une réponse « cahier » : la scène dessinée et ses formules. */
export function NotebookField({
  mode,
  value,
  annotation,
  attemptId,
  onChange,
  onAnnotate,
  label,
}: {
  readonly mode: NotebookMode;
  readonly value: NotebookValue;
  readonly annotation?: readonly unknown[];
  readonly attemptId?: string;
  readonly onChange?: (value: NotebookValue) => void;
  /** Mode « annotate » : reçoit le seul calque du tuteur. */
  readonly onAnnotate?: (elements: readonly unknown[]) => void;
  readonly label: string;
}) {
  return (
    <div className="stack">
      <Suspense fallback={<p role="status">Chargement du cahier…</p>}>
        <NotebookCanvas
          mode={mode}
          label={label}
          elements={value.elements}
          {...(annotation === undefined ? {} : { annotation })}
          {...(attemptId === undefined ? {} : { attemptId })}
          {...(mode === "edit" && onChange !== undefined
            ? {
                onChange: (elements: Record<string, unknown>[]) => {
                  onChange({ ...value, elements });
                },
              }
            : mode === "annotate" && onAnnotate !== undefined
              ? { onChange: onAnnotate }
              : {})}
        />
      </Suspense>
      <FormulaList
        formulas={value.formulas}
        readOnly={mode !== "edit"}
        {...(onChange === undefined
          ? {}
          : {
              onChange: (formulas: NotebookFormula[]) => {
                onChange({ ...value, formulas });
              },
            })}
      />
    </div>
  );
}

/** Lecture prudente d'une liste de formules reçue de l'API (déjà validée par le serveur). */
export function formulasOf(raw: readonly unknown[] | undefined): NotebookFormula[] {
  return (raw ?? []).flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    "latex" in item &&
    typeof item.id === "string" &&
    typeof item.latex === "string"
      ? [{ id: item.id, latex: item.latex }]
      : [],
  );
}
