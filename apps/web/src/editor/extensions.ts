import { toSafeHttpsUrl } from "@ardoiz/content-schema";
import { Node, type Extensions } from "@tiptap/core";
import { Table, TableCell, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

/**
 * Extensions de l'éditeur : EXACTEMENT les nœuds et marques du schéma fermé (ADR-0005, R4).
 * Tout ce que l'éditeur produit est revalidé par `validateLessonContent` avant l'envoi, puis par l'API.
 */

/** Image importée (R14) : un identifiant de média et un texte alternatif, jamais une URL. */
const LessonImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ mediaId: { default: null }, alt: { default: "" } }),
  renderHTML: ({ node }) => [
    "figure",
    { class: "editor-image" },
    [
      "img",
      {
        src: `/api/media/${encodeURIComponent(String(node.attrs["mediaId"]))}`,
        alt: String(node.attrs["alt"]),
      },
    ],
  ],
});

/** Formule en ligne : la source LaTeX est montrée dans l'éditeur, le rendu dans l'aperçu. */
const MathInline = Node.create({
  name: "math_inline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: { default: "" } }),
  renderHTML: ({ node }) => ["span", { class: "math-source" }, `ƒ ${String(node.attrs["latex"])}`],
});

const MathBlock = Node.create({
  name: "math_block",
  group: "block",
  atom: true,
  addAttributes: () => ({ latex: { default: "" } }),
  renderHTML: ({ node }) => ["div", { class: "math-source math-block" }, `ƒ ${String(node.attrs["latex"])}`],
});

/** Vidéo : l'identifiant seul ; le lecteur sera toujours youtube-nocookie.com, après un clic (R13). */
const Youtube = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  addAttributes: () => ({ videoId: { default: "" } }),
  renderHTML: ({ node }) => [
    "div",
    { class: "video-source" },
    `▶ Vidéo YouTube ${String(node.attrs["videoId"])}`,
  ],
});

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "(paragraph | bulletList | orderedList | math_block | image)+",
  defining: true,
  addAttributes: () => ({ kind: { default: "info" } }),
  renderHTML: ({ node }) => ["aside", { class: `callout callout-${String(node.attrs["kind"])}` }, 0],
});

/** Lignes de tableau sans cellule d'en-tête : tableHeader n'est pas dans la liste blanche. */
const PlainTableRow = TableRow.extend({ content: "tableCell+" });

/** Cellule sans alignement : l'attribut `align` de TipTap n'est pas dans la liste blanche (ADR-0005). */
const PlainTableCell = TableCell.extend({
  addAttributes() {
    const inherited: Record<string, unknown> = { ...(this.parent?.() ?? {}) };
    delete inherited["align"];
    return inherited;
  },
});

export const EDITOR_EXTENSIONS: Extensions = [
  StarterKit.configure({
    strike: false,
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      // Seuls les liens https sont acceptés (R4), comme dans le validateur.
      isAllowedUri: (url) => toSafeHttpsUrl(url) !== null,
    },
  }),
  Table.configure({ resizable: false }),
  PlainTableRow,
  PlainTableCell,
  LessonImage,
  MathInline,
  MathBlock,
  Youtube,
  Callout,
];
