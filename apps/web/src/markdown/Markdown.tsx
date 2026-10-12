import { lexer, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Rendu Markdown → composants React, sans aucun HTML brut (R4, ADR-0005) : le texte passe par
 * React, qui l'échappe. Un bloc HTML présent dans la source s'affiche comme du texte ; un lien
 * n'est rendu que vers notre site ou en https.
 * Sert aux textes juridiques de docs/juridique, affichés sans modification.
 */
export function Markdown({ source }: { readonly source: string }) {
  return <div className="markdown">{blocks(lexer(source))}</div>;
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

function blocks(tokens: readonly Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `b-${String(index)}`;
    switch (token.type) {
      case "heading": {
        const heading = token as Tokens.Heading;
        const content = inline(heading.tokens, key);
        // Le titre de la page est déjà un h1 : les niveaux du texte sont décalés d'un cran.
        if (heading.depth <= 1) return <h2 key={key}>{content}</h2>;
        if (heading.depth === 2) return <h3 key={key}>{content}</h3>;
        return <h4 key={key}>{content}</h4>;
      }
      case "paragraph":
        return <p key={key}>{inline((token as Tokens.Paragraph).tokens, key)}</p>;
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => (
          <li key={`${key}-${String(itemIndex)}`}>{blocksOrInline(item.tokens, key)}</li>
        ));
        return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      case "blockquote":
        return <blockquote key={key}>{blocks((token as Tokens.Blockquote).tokens)}</blockquote>;
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
          <div className="table-wrapper" key={key}>
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

function blocksOrInline(tokens: readonly Token[], key: string): ReactNode[] {
  return tokens.flatMap((token, index) =>
    token.type === "text"
      ? inline((token as Tokens.Text).tokens ?? [token], `${key}-t-${String(index)}`)
      : blocks([token]),
  );
}
