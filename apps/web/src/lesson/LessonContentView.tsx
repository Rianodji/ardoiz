import {
  toSafeHttpsUrl,
  type BlockNode,
  type InlineNode,
  type LessonContent,
  type Mark,
  type TextNode,
} from "@ardoiz/content-schema";
import type { ReactNode } from "react";
import { TableBox } from "../ui";
import { MathFormula } from "./MathFormula";
import { YouTubeEmbed } from "./YouTubeEmbed";

const CALLOUT_LABELS = { info: "À savoir", astuce: "Astuce", attention: "Attention" } as const;

/**
 * Rendu d'un cours par des composants React (ADR-0005, R4) : chaque nœud du schéma fermé a son
 * composant ; le texte passe par React, qui l'échappe. Aucun HTML fourni par un utilisateur n'est
 * rendu, et un nœud inattendu n'est pas rendu du tout.
 */
export function LessonContentView({ content }: { readonly content: LessonContent }) {
  const anchors = new Map(lessonOutline(content).map((entry) => [entry.index, entry.id]));
  const labels = tableLabels(content);
  return (
    <div className="lesson-content">
      {content.content.map((node, index) =>
        block(node, `b${String(index)}`, anchors.get(index), labels.get(index)),
      )}
    </div>
  );
}

/** Le texte seul d'un titre (sommaire, nom d'un tableau). */
function headingText(nodes: readonly InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((child) =>
      child.type === "text" ? child.text : child.type === "math_inline" ? child.attrs.latex : " ",
    )
    .join("")
    .trim();
}

/**
 * Un tableau qui défile doit être nommé (WCAG 2.1.1, verdict L8 S-11, comme S-9) : il prend le titre
 * de sa partie, numéroté si la partie en contient plusieurs. Un tableau rangé dans un encadré ou une
 * cellule s'appelle simplement « Tableau ».
 */
function tableLabels(content: LessonContent): ReadonlyMap<number, string> {
  const labels = new Map<number, string>();
  const used = new Map<string, number>();
  let section = "";
  for (const [index, node] of content.content.entries()) {
    if (node.type === "heading") section = headingText(node.content);
    if (node.type !== "table") continue;
    const base = section === "" ? "Tableau" : `Tableau : ${section}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    labels.set(index, count === 1 ? base : `${base} (${String(count)})`);
  }
  return labels;
}

/**
 * Sommaire d'un cours (maquette Eleve-Cours) : ses grands titres, dans l'ordre. L'ancre est dérivée de
 * la position, jamais du texte saisi par le tuteur.
 */
export function lessonOutline(
  content: LessonContent,
): ReadonlyArray<{ readonly index: number; readonly id: string; readonly text: string }> {
  return content.content.flatMap((node, index) =>
    node.type === "heading" && node.attrs.level === 1
      ? [
          {
            index,
            id: `partie-${String(index + 1)}`,
            text: headingText(node.content),
          },
        ]
      : [],
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

function block(node: BlockNode, key: string, anchor?: string, tableLabel = "Tableau"): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{inline(node.content, key)}</p>;
    case "heading": {
      // Le titre du cours est le h1 de la page : les titres du contenu commencent au h2.
      const content = inline(node.content, key);
      if (node.attrs.level === 1)
        return (
          <h2 key={key} id={anchor} tabIndex={anchor === undefined ? undefined : -1}>
            {content}
          </h2>
        );
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
      // Défile dans sa boîte, focalisable et nommée (verdict L8, S-11) : rien ne déborde à 360 px.
      return (
        <TableBox key={key} label={tableLabel}>
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
        </TableBox>
      );
  }
}
