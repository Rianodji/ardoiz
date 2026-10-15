import { lexer, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Rendu Markdown → composants React, sans aucun HTML brut (R4, ADR-0005) : le texte passe par
 * React, qui l'échappe. Un bloc HTML présent dans la source s'affiche comme du texte ; un lien
 * n'est rendu que vers notre site ou en https.
 * Sert aux textes juridiques de docs/juridique, affichés sans modification.
 */
export function Markdown({ source, pageTitle }: { readonly source: string; readonly pageTitle?: string }) {
  const tokens = lexer(source);
  const first = tokens.find((token) => token.type === "heading") as Tokens.Heading | undefined;
  const title = pageTitle !== undefined && first?.depth === 1 ? first : null;
  const context: Context = { page: pageTitle !== undefined, title, tableLabels: tableLabels(tokens) };
  return (
    <div className="markdown">
      {/* Document sans titre : la page garde le sien. */}
      {pageTitle !== undefined && title === null && <h1>{pageTitle}</h1>}
      {blocks(tokens, context)}
    </div>
  );
}

/**
 * `page`, `title` : quand le texte est la page (`pageTitle`), son premier titre devient le h1 de la page
 * (verdict L8, S-8) et les niveaux suivants ne sont plus décalés. `tableLabels` : le nom de chaque
 * tableau (S-9).
 */
interface Context {
  readonly page: boolean;
  readonly title: Tokens.Heading | null;
  readonly tableLabels: ReadonlyMap<Token, string>;
}

const HEADINGS = ["h1", "h2", "h3", "h4"] as const;

/** Le texte seul d'un fragment en ligne (titre d'une section), sans sa mise en forme. */
function plainText(tokens: readonly Token[] | undefined): string {
  return (tokens ?? [])
    .map((token) =>
      "tokens" in token && Array.isArray(token.tokens)
        ? plainText(token.tokens)
        : "text" in token && typeof token.text === "string"
          ? decode(token.text)
          : "",
    )
    .join("");
}

/**
 * Un tableau qui défile doit être nommé (WCAG 2.1.1, comme TableBox) : il prend le titre de sa
 * section, numéroté si la section en contient plusieurs.
 */
function tableLabels(tokens: readonly Token[]): ReadonlyMap<Token, string> {
  const labels = new Map<Token, string>();
  const used = new Map<string, number>();
  let section = "";
  for (const token of tokens) {
    if (token.type === "heading") section = plainText((token as Tokens.Heading).tokens);
    if (token.type !== "table") continue;
    const base = section === "" ? "Tableau" : `Tableau : ${section}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    labels.set(token, count === 1 ? base : `${base} (${String(count)})`);
  }
  return labels;
}

function safeHref(href: string): { internal: string } | { external: string } | null {
  if (href.startsWith("/") && !href.startsWith("//")) return { internal: href };
  if (URL.canParse(href) && new URL(href).protocol === "https:") return { external: href };
  return null;
}

function inline(tokens: readonly Token[] | undefined, keyPrefix = "i"): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const key = `${keyPrefix}-${String(index)}`;
    switch (token.type) {
      case "strong":
        return <strong key={key}>{inline((token as Tokens.Strong).tokens, key)}</strong>;
      case "em":
        return <em key={key}>{inline((token as Tokens.Em).tokens, key)}</em>;
      case "codespan":
        return <code key={key}>{(token as Tokens.Codespan).text}</code>;
      case "br":
        return <br key={key} />;
      case "link": {
        const link = token as Tokens.Link;
        const target = safeHref(link.href);
        const children = inline(link.tokens, key);
        if (target === null) return <span key={key}>{children}</span>;
        return "internal" in target ? (
          <Link key={key} to={target.internal}>
            {children}
          </Link>
        ) : (
          <a key={key} href={target.external} rel="noopener noreferrer nofollow" target="_blank">
            {children}
          </a>
        );
      }
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens === undefined ? (
          <span key={key}>{decode(text.text)}</span>
        ) : (
          <span key={key}>{inline(text.tokens, key)}</span>
        );
      }
      case "escape":
        return <span key={key}>{(token as Tokens.Escape).text}</span>;
      default:
        // HTML ou jeton inconnu : affiché tel quel, comme du texte (R4).
        return <span key={key}>{token.raw}</span>;
    }
  });
}

/** marked renvoie certaines entités échappées (&amp;…) dans le texte brut : React les réafficherait littéralement. */
function decode(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function blocks(tokens: readonly Token[], context: Context): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `b-${String(index)}`;
    switch (token.type) {
      case "heading": {
        const heading = token as Tokens.Heading;
        // Texte inséré dans une page : son titre est déjà un h1 : les niveaux du texte sont décalés d'un cran.
        const level = !context.page
          ? Math.min(heading.depth + 1, 4)
          : heading === context.title
            ? 1
            : Math.min(Math.max(heading.depth, 2), 4);
        const Heading = HEADINGS[level - 1] ?? "h4";
        return <Heading key={key}>{inline(heading.tokens, key)}</Heading>;
      }
      case "paragraph":
        return <p key={key}>{inline((token as Tokens.Paragraph).tokens, key)}</p>;
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => (
          <li key={`${key}-${String(itemIndex)}`}>{blocksOrInline(item.tokens, key, context)}</li>
        ));
        return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      case "blockquote":
        return <blockquote key={key}>{blocks((token as Tokens.Blockquote).tokens, context)}</blockquote>;
      case "hr":
        return <hr key={key} />;
      case "code":
        return (
          <pre key={key}>
            <code>{(token as Tokens.Code).text}</code>
          </pre>
        );
      case "table": {
        const table = token as Tokens.Table;
        return (
          // Défile comme TableBox, focalisable et nommé (verdict L8, S-9) : rien ne déborde à 360 px.
          <div
            className="table-box"
            role="region"
            aria-label={context.tableLabels.get(token) ?? "Tableau"}
            tabIndex={0}
            key={key}
          >
            <table>
              <thead>
                <tr>
                  {table.header.map((cell, cellIndex) => (
                    <th key={`${key}-h-${String(cellIndex)}`} scope="col">
                      {inline(cell.tokens, `${key}-h-${String(cellIndex)}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${key}-r-${String(rowIndex)}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${key}-${String(rowIndex)}-${String(cellIndex)}`}>
                        {inline(cell.tokens, `${key}-${String(rowIndex)}-${String(cellIndex)}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "space":
        return null;
      case "text":
        return <p key={key}>{inline((token as Tokens.Text).tokens ?? [token], key)}</p>;
      default:
        // Bloc HTML ou inconnu : du texte, jamais du balisage (R4).
        return (
          <p key={key} className="raw">
            {token.raw}
          </p>
        );
    }
  });
}

function blocksOrInline(tokens: readonly Token[], key: string, context: Context): ReactNode[] {
  return tokens.flatMap((token, index) =>
    token.type === "text"
      ? inline((token as Tokens.Text).tokens ?? [token], `${key}-t-${String(index)}`)
      : blocks([token], context),
  );
}
