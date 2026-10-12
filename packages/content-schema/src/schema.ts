/**
 * Schéma fermé du document de cours (ADR-0005, R4) : liste blanche des nœuds, des marques et des
 * attributs, partagée par l'API (validation à l'écriture) et par le front (éditeur, aperçu, rendu).
 */
export const LESSON_CONTENT_SCHEMA_VERSION = 1;

export const CALLOUT_KINDS = ["info", "astuce", "attention"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export type Mark =
  | { readonly type: "bold" | "italic" | "underline" | "code" }
  | { readonly type: "link"; readonly attrs: { readonly href: string } };

export interface TextNode {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly Mark[];
}
export interface HardBreakNode {
  readonly type: "hardBreak";
}
export interface MathInlineNode {
  readonly type: "math_inline";
  readonly attrs: { readonly latex: string };
}
export type InlineNode = TextNode | HardBreakNode | MathInlineNode;

export interface ParagraphNode {
  readonly type: "paragraph";
  readonly content?: readonly InlineNode[];
}
export interface HeadingNode {
  readonly type: "heading";
  readonly attrs: { readonly level: 1 | 2 | 3 };
  readonly content?: readonly InlineNode[];
}
export interface ListItemNode {
  readonly type: "listItem";
  readonly content: readonly BlockNode[];
}
export interface BulletListNode {
  readonly type: "bulletList";
  readonly content: readonly ListItemNode[];
}
export interface OrderedListNode {
  readonly type: "orderedList";
  readonly attrs?: { readonly start?: number };
  readonly content: readonly ListItemNode[];
}
export interface BlockquoteNode {
  readonly type: "blockquote";
  readonly content: readonly BlockNode[];
}
export interface CodeBlockNode {
  readonly type: "codeBlock";
  readonly content?: readonly TextNode[];
}
export interface HorizontalRuleNode {
  readonly type: "horizontalRule";
}
export interface ImageNode {
  readonly type: "image";
  readonly attrs: { readonly mediaId: string; readonly alt: string };
}
export interface MathBlockNode {
  readonly type: "math_block";
  readonly attrs: { readonly latex: string };
}
export interface YoutubeNode {
  readonly type: "youtube";
  readonly attrs: { readonly videoId: string };
}
export interface CalloutNode {
  readonly type: "callout";
  readonly attrs: { readonly kind: CalloutKind };
  readonly content: readonly BlockNode[];
}
export interface TableCellNode {
  readonly type: "tableCell";
  readonly attrs?: { readonly colspan?: number; readonly rowspan?: number };
  readonly content: readonly BlockNode[];
}
export interface TableRowNode {
  readonly type: "tableRow";
  readonly content: readonly TableCellNode[];
}
export interface TableNode {
  readonly type: "table";
  readonly content: readonly TableRowNode[];
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | CodeBlockNode
  | HorizontalRuleNode
  | ImageNode
  | MathBlockNode
  | YoutubeNode
  | CalloutNode
  | TableNode;

/** Document de cours validé. Le type n'est obtenu QUE par `validateLessonContent`. */
export interface LessonContent {
  readonly type: "doc";
  readonly content: readonly BlockNode[];
}

/** Identifiant de vidéo YouTube : exactement 11 caractères du jeu base64url (R4, R13). */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Média importé et réencodé (R14) : identifiant préfixé de l'application. */
export const MEDIA_ID = /^med_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Bornes du document (R15, M14). */
export const LIMITS = {
  maxNodes: 5_000,
  maxDepth: 12,
  maxTextLength: 10_000,
  maxAltLength: 300,
  maxHrefLength: 2_000,
  maxTableRows: 100,
  maxTableColumns: 20,
  maxSerializedLength: 500_000,
} as const;
