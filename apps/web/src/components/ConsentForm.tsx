import { useQuery } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { fetchLegal, type Consent } from "../api/identity";
import { Markdown } from "../markdown/Markdown";
import { ErrorMessage } from "./ErrorMessage";

const CHECKBOX_LINE = /^☐\s*/;
const BUTTON_LINE = /^\[\s*(.+?)\s*\]$/;

/**
 * Consentement parental (R16), texte docs/juridique/consentement-parental-v1.md affiché en entier.
 * Ses deux dernières lignes décrivent les commandes : la ligne « ☐ … » devient le libellé de la
 * case (non pré-cochée), la ligne « [ … ] » celui du bouton, inactif tant que la case n'est pas cochée.
 * QUESTION Q13 : lecture à confirmer par le lead.
 */
export function ConsentForm({
  children,
  onSubmit,
  pending,
}: {
  readonly children?: ReactNode;
  readonly onSubmit: (consent: Consent) => void;
  readonly pending: boolean;
}) {
  const consent = useQuery({
    queryKey: ["legal", "consentement"],
    queryFn: () => fetchLegal("consentement"),
  });
  const [checked, setChecked] = useState(false);
  const checkboxId = useId();

  if (consent.isPending) return <p role="status">Chargement du texte de consentement…</p>;
  if (consent.isError) return <ErrorMessage error={consent.error} />;

  const lines = consent.data.markdown.trimEnd().split("\n");
  const buttonLine = lines.findLast((line) => BUTTON_LINE.test(line.trim())) ?? "[ Je donne mon accord ]";
  const checkboxLine = lines.findLast((line) => CHECKBOX_LINE.test(line.trim())) ?? "";
  const body = lines.filter((line) => line !== buttonLine && line !== checkboxLine).join("\n");
  const buttonLabel = BUTTON_LINE.exec(buttonLine.trim())?.[1] ?? "Je donne mon accord";
  const version = consent.data.version ?? "";

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (checked) onSubmit({ accepted: true, version, sha256: consent.data.sha256 });
      }}
    >
      <section className="legal-text" aria-label="Texte du consentement parental">
        <Markdown source={body} />
      </section>
      {children}
      <div className="checkbox">
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
        />
        <label htmlFor={checkboxId}>
          <Markdown source={checkboxLine.replace(CHECKBOX_LINE, "")} />
        </label>
      </div>
      <button type="submit" className="button" disabled={!checked || pending}>
        {buttonLabel}
      </button>
    </form>
  );
}
