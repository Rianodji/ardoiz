import {
  toSafeHttpsUrl,
  type BlockNode,
  type InlineNode,
  type LessonContent,
  type Mark,
  type TextNode,
} from "@ardoiz/content-schema";
import type { ReactNode } from "react";
import { MathFormula } from "./MathFormula";
import { YouTubeEmbed } from "./YouTubeEmbed";

const CALLOUT_LABELS = { info: "À savoir", astuce: "Astuce", attention: "Attention" } as const;

/**
 * Rendu d'un cours par des composants React (ADR-0005, R4) : chaque nœud du schéma fermé a son
 * composant ; le texte passe par React, qui l'échappe. Aucun HTML fourni par un utilisateur n'est
 * rendu, et un nœud inattendu n'est pas rendu du tout.
 */
export function LessonContentView({ content }: { readonly content: LessonContent }) {
  return (
    <div className="lesson-content">
      {content.content.map((node, index) => block(node, `b${String(index)}`))}
    </div>
  );
}

function marked(node: TextNode, key: string): ReactNode {
  let element: ReactNode = node.text;
  for (const [index, mark] of (node.marks ?? []).entries())
    element = applyMark(mark, element, `${key}m${String(index)}`);
  return <span key={key}>{element}</span>;
}

function applyMark(mark: Mark, child: ReactNode, key: string): ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong key={key}>{child}</strong>;
    case "italic":
      return <em key={key}>{child}</em>;
    case "underline":
      return <u key={key}>{child}</u>;
    case "code":
      return <code key={key}>{child}</code>;
    case "link": {
      // Revalidé au rendu : seul un lien https est cliquable, et il s'ouvre sans lien avec la page (R4).
      const href = toSafeHttpsUrl(mark.attrs.href);
      return href === null ? (
        <span key={key}>{child}</span>
      ) : (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
          {child}
        </a>
      );
    }
  }
}

function inline(nodes: readonly InlineNode[] | undefined, key: string): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    const childKey = `${key}i${String(index)}`;
    switch (node.type) {
      case "text":
        return marked(node, childKey);
      case "hardBreak":
        return <br key={childKey} />;
      case "math_inline":
        return <MathFormula key={childKey} latex={node.attrs.latex} display={false} />;
    }
  });
}

function blocks(nodes: readonly BlockNode[], key: string): ReactNode[] {
  return nodes.map((node, index) => block(node, `${key}.${String(index)}`));
}

function block(node: BlockNode, key: string): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{inline(node.content, key)}</p>;
    case "heading": {
      // Le titre du cours est le h1 de la page : les titres du contenu commencent au h2.
      const content = inline(node.content, key);
      if (node.attrs.level === 1) return <h2 key={key}>{content}</h2>;
      if (node.attrs.level === 2) return <h3 key={key}>{content}</h3>;
      return <h4 key={key}>{content}</h4>;
    }
    case "bulletList":
      return (
        <ul key={key}>
          {node.content.map((item, index) => (
            <li key={`${key}l${String(index)}`}>{blocks(item.content, `${key}l${String(index)}`)}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={node.attrs?.start ?? 1}>
          {node.content.map((item, index) => (
            <li key={`${key}l${String(index)}`}>{blocks(item.content, `${key}l${String(index)}`)}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return <blockquote key={key}>{blocks(node.content, key)}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{(node.content ?? []).map((text) => text.text).join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "image":
      // Servie par la route autorisée : mêmes droits que le cours (R3, R14).
      return (
        <figure key={key}>
          <img
            src={`/api/media/${encodeURIComponent(node.attrs.mediaId)}`}
            alt={node.attrs.alt}
            loading="lazy"
          />
        </figure>
      );
    case "math_block":
      return <MathFormula key={key} latex={node.attrs.latex} display />;
    case "youtube":
      return <YouTubeEmbed key={key} videoId={node.attrs.videoId} />;
    case "callout":
      return (
        <aside
          key={key}
          className={`callout callout-${node.attrs.kind}`}
          aria-label={CALLOUT_LABELS[node.attrs.kind]}
        >
          <p className="callout-title">{CALLOUT_LABELS[node.attrs.kind]}</p>
          {blocks(node.content, key)}
        </aside>
      );
    case "table":
      return (
        <div className="table-wrapper" key={key}>
          <table>
            <tbody>
              {node.content.map((row, rowIndex) => (
                <tr key={`${key}r${String(rowIndex)}`}>
                  {row.content.map((cell, cellIndex) => (
                    <td
                      key={`${key}r${String(rowIndex)}c${String(cellIndex)}`}
                      colSpan={cell.attrs?.colspan ?? 1}
                      rowSpan={cell.attrs?.rowspan ?? 1}
                    >
                      {blocks(cell.content, `${key}r${String(rowIndex)}c${String(cellIndex)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
