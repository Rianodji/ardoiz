import { checkLatex } from "./math.js";
import {
  CALLOUT_KINDS,
  LIMITS,
  MEDIA_ID,
  YOUTUBE_ID,
  type BlockNode,
  type CalloutKind,
  type InlineNode,
  type LessonContent,
  type ListItemNode,
  type Mark,
  type TableCellNode,
  type TableRowNode,
  type TextNode,
} from "./schema.js";

/** Problème trouvé dans un document : où (chemin JSON) et quoi (code stable), jamais la valeur reçue. */
export interface ContentProblem {
  readonly path: string;
  readonly code: string;
}

export type ContentValidation =
  | { readonly ok: true; readonly value: LessonContent }
  | { readonly ok: false; readonly problems: readonly ContentProblem[] };

type Json = Readonly<Record<string, unknown>>;

/**
 * Caractères de contrôle (sauf le saut de ligne) et marques de direction bidirectionnelle (attaques
 * « trojan source ») : refusés dans le texte. Testés par point de code, sans caractère invisible
 * dans le source.
 */
function hasForbiddenCharacter(value: string, allowNewline = false): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a && allowNewline) continue;
    if (code <= 0x1f || code === 0x7f) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

class Rejection extends Error {
  constructor(
    readonly path: string,
    readonly code: string,
  ) {
    super(code);
  }
}

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Valide un document de cours contre le schéma fermé (ADR-0005, R4). Tout nœud, marque, attribut ou
 * clé inconnus sont REFUSÉS : rien n'est nettoyé en silence. La valeur renvoyée est une copie
 * normalisée, construite champ par champ : aucun objet reçu n'est réutilisé tel quel.
 * Fonction pure, partagée par l'API (écriture) et le front (aperçu, éditeur).
 */
export function validateLessonContent(input: unknown): ContentValidation {
  try {
    if (JSON.stringify(input).length > LIMITS.maxSerializedLength)
      throw new Rejection("$", "document-too-large");
    const counter = { nodes: 0 };
    if (!isObject(input)) throw new Rejection("$", "not-an-object");
    expectKeys(input, ["type", "content"], "$");
    if (input["type"] !== "doc") throw new Rejection("$.type", "unknown-node");
    const content = blocks(input["content"], "$.content", 1, counter, { allowEmpty: false });
    return { ok: true, value: { type: "doc", content } };
  } catch (error) {
    if (error instanceof Rejection) return { ok: false, problems: [{ path: error.path, code: error.code }] };
    if (error instanceof RangeError)
      return { ok: false, problems: [{ path: "$", code: "document-too-deep" }] };
    throw error;
  }
}

function expectKeys(node: Json, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) throw new Rejection(`${path}.${key}`, "unknown-key");
  }
}

function attrsOf(node: Json, allowed: readonly string[], path: string): Json {
  const attrs = node["attrs"];
  if (attrs === undefined) return {};
  if (!isObject(attrs)) throw new Rejection(`${path}.attrs`, "invalid-attrs");
  for (const key of Object.keys(attrs)) {
    if (!allowed.includes(key)) throw new Rejection(`${path}.attrs.${key}`, "unknown-attribute");
  }
  return attrs;
}

function arrayOf(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Rejection(path, "content-not-an-array");
  return value;
}

function enter(counter: { nodes: number }, depth: number, path: string): void {
  counter.nodes++;
  if (counter.nodes > LIMITS.maxNodes) throw new Rejection(path, "too-many-nodes");
  if (depth > LIMITS.maxDepth) throw new Rejection(path, "document-too-deep");
}

function blocks(
  value: unknown,
  path: string,
  depth: number,
  counter: { nodes: number },
  options: { allowEmpty: boolean; inCallout?: boolean },
): BlockNode[] {
  const items = arrayOf(value, path);
  if (items.length === 0 && !options.allowEmpty) throw new Rejection(path, "empty-content");
  return items.map((item, index) =>
    block(item, `${path}[${String(index)}]`, depth, counter, options.inCallout ?? false),
  );
}

function block(
  value: unknown,
  path: string,
  depth: number,
  counter: { nodes: number },
  inCallout: boolean,
): BlockNode {
  enter(counter, depth, path);
  if (!isObject(value)) throw new Rejection(path, "not-an-object");
  const type = value["type"];
  switch (type) {
    case "paragraph": {
      expectKeys(value, ["type", "content"], path);
      const content = inlines(value["content"], `${path}.content`, depth + 1, counter);
      return content === undefined ? { type } : { type, content };
    }
    case "heading": {
      expectKeys(value, ["type", "attrs", "content"], path);
      const level = attrsOf(value, ["level"], path)["level"];
      if (level !== 1 && level !== 2 && level !== 3)
        throw new Rejection(`${path}.attrs.level`, "invalid-heading-level");
      const content = inlines(value["content"], `${path}.content`, depth + 1, counter);
      return content === undefined ? { type, attrs: { level } } : { type, attrs: { level }, content };
    }
    case "bulletList": {
      expectKeys(value, ["type", "content"], path);
      return { type, content: listItems(value["content"], `${path}.content`, depth + 1, counter) };
    }
    case "orderedList": {
      expectKeys(value, ["type", "attrs", "content"], path);
      const attrs = attrsOf(value, ["start", "type"], path);
      // TipTap émet `type: null` ; toute autre valeur est refusée.
      if (attrs["type"] !== undefined && attrs["type"] !== null)
        throw new Rejection(`${path}.attrs.type`, "invalid-attribute");
      const start = attrs["start"] ?? 1;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 1 || start > 10_000) {
        throw new Rejection(`${path}.attrs.start`, "invalid-attribute");
      }
      return {
        type,
        attrs: { start },
        content: listItems(value["content"], `${path}.content`, depth + 1, counter),
      };
    }
    case "blockquote": {
      expectKeys(value, ["type", "content"], path);
      return {
        type,
        content: blocks(value["content"], `${path}.content`, depth + 1, counter, {
          allowEmpty: false,
          inCallout,
        }),
      };
    }
    case "codeBlock": {
      expectKeys(value, ["type", "attrs", "content"], path);
      const language = attrsOf(value, ["language"], path)["language"];
      if (language !== undefined && language !== null)
        throw new Rejection(`${path}.attrs.language`, "invalid-attribute");
      const texts = value["content"] === undefined ? [] : arrayOf(value["content"], `${path}.content`);
      // Bloc de code : texte brut seulement, sans marque ni autre nœud.
      const content = texts.map((item, index) => {
        const node = inline(item, `${path}.content[${String(index)}]`, depth + 1, counter);
        if (node.type !== "text" || node.marks !== undefined)
          throw new Rejection(`${path}.content[${String(index)}]`, "invalid-code-content");
        return node;
      });
      return content.length === 0 ? { type } : { type, content };
    }
    case "horizontalRule": {
      expectKeys(value, ["type"], path);
      return { type };
    }
    case "image": {
      expectKeys(value, ["type", "attrs"], path);
      const attrs = attrsOf(value, ["mediaId", "alt"], path);
      const mediaId = attrs["mediaId"];
      const alt = attrs["alt"] ?? "";
      if (typeof mediaId !== "string" || !MEDIA_ID.test(mediaId))
        throw new Rejection(`${path}.attrs.mediaId`, "invalid-media-id");
      if (typeof alt !== "string" || alt.length > LIMITS.maxAltLength || hasForbiddenCharacter(alt)) {
        throw new Rejection(`${path}.attrs.alt`, "invalid-alt");
      }
      return { type, attrs: { mediaId, alt } };
    }
    case "math_block": {
      expectKeys(value, ["type", "attrs"], path);
      return { type, attrs: { latex: latexOf(value, path, true) } };
    }
    case "youtube": {
      expectKeys(value, ["type", "attrs"], path);
      const videoId = attrsOf(value, ["videoId"], path)["videoId"];
      if (typeof videoId !== "string" || !YOUTUBE_ID.test(videoId))
        throw new Rejection(`${path}.attrs.videoId`, "invalid-video-id");
      return { type, attrs: { videoId } };
    }
    case "callout": {
      expectKeys(value, ["type", "attrs", "content"], path);
      // Un encadré ne contient pas d'autre encadré.
      if (inCallout) throw new Rejection(path, "nested-callout");
      const kind = attrsOf(value, ["kind"], path)["kind"];
      const found = CALLOUT_KINDS.find((candidate): candidate is CalloutKind => candidate === kind);
      if (found === undefined) throw new Rejection(`${path}.attrs.kind`, "invalid-callout-kind");
      return {
        type,
        attrs: { kind: found },
        content: blocks(value["content"], `${path}.content`, depth + 1, counter, {
          allowEmpty: false,
          inCallout: true,
        }),
      };
    }
    case "table": {
      expectKeys(value, ["type", "content"], path);
      const rows = arrayOf(value["content"], `${path}.content`);
      if (rows.length === 0 || rows.length > LIMITS.maxTableRows)
        throw new Rejection(`${path}.content`, "invalid-table-size");
      return {
        type,
        content: rows.map((row, index) =>
          tableRow(row, `${path}.content[${String(index)}]`, depth + 1, counter),
        ),
      };
    }
    default:
      throw new Rejection(`${path}.type`, "unknown-node");
  }
}

function listItems(value: unknown, path: string, depth: number, counter: { nodes: number }): ListItemNode[] {
  const items = arrayOf(value, path);
  if (items.length === 0) throw new Rejection(path, "empty-content");
  return items.map((item, index) => {
    const itemPath = `${path}[${String(index)}]`;
    enter(counter, depth, itemPath);
    if (!isObject(item) || item["type"] !== "listItem")
      throw new Rejection(`${itemPath}.type`, "unknown-node");
    expectKeys(item, ["type", "content"], itemPath);
    const content = blocks(item["content"], `${itemPath}.content`, depth + 1, counter, { allowEmpty: false });
    if (content[0]?.type !== "paragraph")
      throw new Rejection(`${itemPath}.content[0]`, "list-item-needs-paragraph");
    return { type: "listItem", content };
  });
}

function tableRow(value: unknown, path: string, depth: number, counter: { nodes: number }): TableRowNode {
  enter(counter, depth, path);
  if (!isObject(value) || value["type"] !== "tableRow") throw new Rejection(`${path}.type`, "unknown-node");
  expectKeys(value, ["type", "content"], path);
  const cells = arrayOf(value["content"], `${path}.content`);
  if (cells.length === 0 || cells.length > LIMITS.maxTableColumns)
    throw new Rejection(`${path}.content`, "invalid-table-size");
  return {
    type: "tableRow",
    content: cells.map((cell, index) =>
      tableCell(cell, `${path}.content[${String(index)}]`, depth + 1, counter),
    ),
  };
}

function tableCell(value: unknown, path: string, depth: number, counter: { nodes: number }): TableCellNode {
  enter(counter, depth, path);
  // Pas de cellule d'en-tête (tableHeader) : elle ne fait pas partie de la liste blanche de l'ADR-0005.
  if (!isObject(value) || value["type"] !== "tableCell") throw new Rejection(`${path}.type`, "unknown-node");
  expectKeys(value, ["type", "attrs", "content"], path);
  const attrs = attrsOf(value, ["colspan", "rowspan", "colwidth"], path);
  const span = (name: "colspan" | "rowspan"): number => {
    const raw = attrs[name] ?? 1;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > LIMITS.maxTableColumns) {
      throw new Rejection(`${path}.attrs.${name}`, "invalid-attribute");
    }
    return raw;
  };
  if (attrs["colwidth"] !== undefined && attrs["colwidth"] !== null)
    throw new Rejection(`${path}.attrs.colwidth`, "invalid-attribute");
  const colspan = span("colspan");
  const rowspan = span("rowspan");
  const content = blocks(value["content"], `${path}.content`, depth + 1, counter, { allowEmpty: false });
  for (const [index, child] of content.entries()) {
    if (child.type !== "paragraph")
      throw new Rejection(`${path}.content[${String(index)}]`, "table-cell-needs-paragraph");
  }
  return colspan === 1 && rowspan === 1
    ? { type: "tableCell", content }
    : { type: "tableCell", attrs: { colspan, rowspan }, content };
}

function inlines(
  value: unknown,
  path: string,
  depth: number,
  counter: { nodes: number },
): InlineNode[] | undefined {
  if (value === undefined) return undefined;
  return arrayOf(value, path).map((item, index) => inline(item, `${path}[${String(index)}]`, depth, counter));
}

function inline(value: unknown, path: string, depth: number, counter: { nodes: number }): InlineNode {
  enter(counter, depth, path);
  if (!isObject(value)) throw new Rejection(path, "not-an-object");
  switch (value["type"]) {
    case "text": {
      expectKeys(value, ["type", "text", "marks"], path);
      const text = value["text"];
      if (typeof text !== "string" || text.length === 0 || text.length > LIMITS.maxTextLength) {
        throw new Rejection(`${path}.text`, "invalid-text");
      }
      if (hasForbiddenCharacter(text)) throw new Rejection(`${path}.text`, "forbidden-character");
      const marks = value["marks"] === undefined ? undefined : marksOf(value["marks"], `${path}.marks`);
      const node: TextNode =
        marks === undefined || marks.length === 0 ? { type: "text", text } : { type: "text", text, marks };
      return node;
    }
    case "hardBreak": {
      expectKeys(value, ["type"], path);
      return { type: "hardBreak" };
    }
    case "math_inline": {
      expectKeys(value, ["type", "attrs"], path);
      return { type: "math_inline", attrs: { latex: latexOf(value, path, false) } };
    }
    default:
      throw new Rejection(`${path}.type`, "unknown-node");
  }
}

function marksOf(value: unknown, path: string): Mark[] {
  const seen = new Set<string>();
  return arrayOf(value, path).map((item, index) => {
    const markPath = `${path}[${String(index)}]`;
    if (!isObject(item)) throw new Rejection(markPath, "not-an-object");
    const type = item["type"];
    if (typeof type !== "string" || seen.has(type)) throw new Rejection(`${markPath}.type`, "invalid-mark");
    seen.add(type);
    switch (type) {
      case "bold":
      case "italic":
      case "underline":
      case "code":
        expectKeys(item, ["type"], markPath);
        return { type };
      case "link": {
        expectKeys(item, ["type", "attrs"], markPath);
        const attrs = attrsOf(item, ["href", "target", "rel", "class"], markPath);
        // Valeurs émises par l'extension Link de TipTap : acceptées, puis ignorées (le rendu fixe les siennes).
        if (attrs["target"] !== undefined && attrs["target"] !== null && attrs["target"] !== "_blank") {
          throw new Rejection(`${markPath}.attrs.target`, "invalid-attribute");
        }
        if (
          attrs["rel"] !== undefined &&
          attrs["rel"] !== null &&
          attrs["rel"] !== "noopener noreferrer nofollow"
        ) {
          throw new Rejection(`${markPath}.attrs.rel`, "invalid-attribute");
        }
        if (attrs["class"] !== undefined && attrs["class"] !== null)
          throw new Rejection(`${markPath}.attrs.class`, "invalid-attribute");
        return { type: "link", attrs: { href: httpsUrl(attrs["href"], `${markPath}.attrs.href`) } };
      }
      default:
        throw new Rejection(`${markPath}.type`, "unknown-mark");
    }
  });
}

/** Lien : URL absolue en https, sans identifiants, sans espaces ni caractères de contrôle (R4). */
function httpsUrl(value: unknown, path: string): string {
  const safe = toSafeHttpsUrl(value);
  if (safe === null) throw new Rejection(path, "invalid-link");
  return safe;
}

/** Version sans exception, pour le rendu et l'éditeur : l'URL normalisée, ou null si elle est refusée. */
export function toSafeHttpsUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > LIMITS.maxHrefLength ||
    /\s/.test(value) ||
    hasForbiddenCharacter(value)
  )
    return null;
  if (!value.toLowerCase().startsWith("https://") || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  return url.toString();
}

function latexOf(node: Json, path: string, displayMode: boolean): string {
  const latex = attrsOf(node, ["latex"], path)["latex"];
  if (typeof latex !== "string") throw new Rejection(`${path}.attrs.latex`, "latex-invalid");
  if (hasForbiddenCharacter(latex, true)) throw new Rejection(`${path}.attrs.latex`, "forbidden-character");
  const problem = checkLatex(latex, displayMode);
  if (problem !== null) throw new Rejection(`${path}.attrs.latex`, problem);
  return latex;
}

/** Identifiants des médias référencés par un document validé (vérifiés à l'écriture : R3, R14). */
export function mediaIdsOf(content: LessonContent): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (!isObject(node)) return;
    const attrs = node["attrs"];
    if (node["type"] === "image" && isObject(attrs) && typeof attrs["mediaId"] === "string")
      ids.add(attrs["mediaId"]);
    const children = node["content"];
    if (Array.isArray(children)) for (const child of children) visit(child);
  };
  visit(content);
  return [...ids];
}
