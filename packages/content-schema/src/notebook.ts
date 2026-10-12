import { checkLatex } from "./math.js";

/**
 * Schéma FERMÉ d'une scène du cahier virtuel (ADR-0004, R4, R6, R14, R15).
 *
 * Une scène est la liste des éléments Excalidraw, réduite aux propriétés listées ici, plus des blocs de
 * formules LaTeX. Tout type, toute clé ou toute valeur hors de ce schéma est REFUSÉ : rien n'est
 * nettoyé en silence. En particulier :
 * - aucun lien (`link` toujours nul), aucune donnée libre (`customData`), aucun cadre ni iframe ;
 * - aucune image intégrée : une image ne référence qu'un média importé et réencodé par le serveur (R14) ;
 * - au plus 2 000 éléments et 5 Mo de JSON (R15) ;
 * - le texte est du texte : il est dessiné sur le canevas, jamais interprété comme du HTML (R4).
 * La valeur renvoyée est une copie normalisée, construite champ par champ.
 */
export const NOTEBOOK_LIMITS = {
  maxElements: 2_000,
  /** Taille du JSON canonique de la scène, en octets UTF-8. */
  maxBytes: 5_000_000,
  maxFormulas: 50,
  maxPointsPerElement: 20_000,
  maxTextLength: 10_000,
  maxCoordinate: 1_000_000,
  maxGroupIds: 16,
  maxBoundElements: 64,
} as const;

/** Identifiant d'un média du cahier (préfixe `nmd_` + UUID) : seule forme de `fileId` acceptée. */
export const NOTEBOOK_MEDIA_ID = /^nmd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FRACTIONAL_INDEX = /^[A-Za-z0-9]{1,64}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|transparent)$/;
const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"] as const;
const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
const TEXT_ALIGNS = ["left", "center", "right"] as const;
const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
const ARROWHEADS = [
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
] as const;
const IMAGE_STATUSES = ["pending", "saved", "error"] as const;

export const NOTEBOOK_ELEMENT_TYPES = [
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
] as const;
export type NotebookElementType = (typeof NOTEBOOK_ELEMENT_TYPES)[number];

/** Élément stocké : objet JSON aux seules clés du schéma (le type précis est garanti par le validateur). */
export type NotebookElement = Readonly<Record<string, unknown>> & {
  readonly type: NotebookElementType;
  readonly id: string;
};

export interface NotebookFormula {
  readonly id: string;
  readonly latex: string;
}

export interface NotebookScene {
  readonly elements: readonly NotebookElement[];
  readonly formulas: readonly NotebookFormula[];
}

export interface NotebookProblem {
  readonly path: string;
  readonly code:
    | "notebook-invalid"
    | "notebook-too-many-elements"
    | "notebook-too-large"
    | "notebook-forbidden-type"
    | "notebook-link-forbidden"
    | "notebook-unknown-key"
    | "notebook-unknown-media"
    | "notebook-image-forbidden"
    | "notebook-invalid-formula";
}

export type NotebookValidation =
  | { readonly ok: true; readonly value: NotebookScene }
  | { readonly ok: false; readonly problems: readonly NotebookProblem[] };

export interface NotebookOptions {
  /** Médias importés pour cette copie : une image ne peut référencer qu'eux (R14). */
  readonly mediaIds: ReadonlySet<string>;
  /** Calque d'annotation du tuteur : aucune image, aucune formule. */
  readonly annotation?: boolean;
}

class Rejection extends Error {
  constructor(
    readonly path: string,
    readonly code: NotebookProblem["code"],
  ) {
    super(code);
  }
}

type Json = Readonly<Record<string, unknown>>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x09) continue;
    if (code <= 0x1f || code === 0x7f) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

/** Lecteur d'un objet : chaque clé lue est retenue ; une clé non lue à la fin est une clé inconnue. */
class Reader {
  private readonly seen = new Set<string>();

  constructor(
    private readonly object: Json,
    readonly path: string,
  ) {}

  private take(key: string): unknown {
    this.seen.add(key);
    return this.object[key];
  }

  private fail(key: string): never {
    throw new Rejection(`${this.path}.${key}`, "notebook-invalid");
  }

  number(key: string, min: number, max: number): number {
    const value = this.take(key);
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) this.fail(key);
    return value;
  }

  integer(key: string, min: number, max: number): number {
    const value = this.number(key, min, max);
    if (!Number.isInteger(value)) this.fail(key);
    return value;
  }

  boolean(key: string): boolean {
    const value = this.take(key);
    if (typeof value !== "boolean") this.fail(key);
    return value;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T {
    const value = this.take(key);
    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) this.fail(key);
    return value as T;
  }

  pattern(key: string, pattern: RegExp): string {
    const value = this.take(key);
    if (typeof value !== "string" || !pattern.test(value)) this.fail(key);
    return value;
  }

  text(key: string, max: number): string {
    const value = this.take(key);
    if (typeof value !== "string" || value.length > max || hasForbiddenCharacter(value)) this.fail(key);
    return value;
  }

  /** Lit une clé facultative : absente, elle n'est pas recopiée. */
  optional<T>(key: string, read: (reader: Reader) => T): T | undefined {
    if (!(key in this.object)) return undefined;
    return read(this);
  }

  nullable<T>(key: string, read: (value: unknown, path: string) => T): T | null {
    const value = this.take(key);
    return value === null ? null : read(value, `${this.path}.${key}`);
  }

  raw(key: string): unknown {
    return this.take(key);
  }

  /** Toute clé non lue est refusée : le schéma est fermé. */
  close(): void {
    for (const key of Object.keys(this.object)) {
      if (!this.seen.has(key)) throw new Rejection(`${this.path}.${key}`, "notebook-unknown-key");
    }
  }
}

const C = NOTEBOOK_LIMITS.maxCoordinate;

function point(value: unknown, path: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Rejection(path, "notebook-invalid");
  const [x, y] = value as unknown[];
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Rejection(path, "notebook-invalid");
  }
  if (Math.abs(x) > C || Math.abs(y) > C) throw new Rejection(path, "notebook-invalid");
  return [x, y];
}

function points(value: unknown, path: string, min: number): Array<[number, number]> {
  if (!Array.isArray(value) || value.length < min || value.length > NOTEBOOK_LIMITS.maxPointsPerElement) {
    throw new Rejection(path, "notebook-invalid");
  }
  return value.map((item, index) => point(item, `${path}[${String(index)}]`));
}

function binding(value: unknown, path: string) {
  if (!isObject(value)) throw new Rejection(path, "notebook-invalid");
  const reader = new Reader(value, path);
  const result = {
    elementId: reader.pattern("elementId", ELEMENT_ID),
    focus: reader.number("focus", -C, C),
    gap: reader.number("gap", -C, C),
    ...(() => {
      const fixed = reader.optional("fixedPoint", (r) => r.nullable("fixedPoint", point));
      return fixed === undefined ? {} : { fixedPoint: fixed };
    })(),
  };
  reader.close();
  return result;
}

function base(reader: Reader) {
  const groupIds = reader.raw("groupIds");
  if (!Array.isArray(groupIds) || groupIds.length > NOTEBOOK_LIMITS.maxGroupIds) {
    throw new Rejection(`${reader.path}.groupIds`, "notebook-invalid");
  }
  for (const groupId of groupIds) {
    if (typeof groupId !== "string" || !ELEMENT_ID.test(groupId))
      throw new Rejection(`${reader.path}.groupIds`, "notebook-invalid");
  }
  if (reader.raw("link") !== null) throw new Rejection(`${reader.path}.link`, "notebook-link-forbidden");
  if (reader.raw("frameId") !== null) throw new Rejection(`${reader.path}.frameId`, "notebook-invalid");
  return {
    id: reader.pattern("id", ELEMENT_ID),
    x: reader.number("x", -C, C),
    y: reader.number("y", -C, C),
    width: reader.number("width", -C, C),
    height: reader.number("height", -C, C),
    angle: reader.number("angle", -7, 7),
    strokeColor: reader.pattern("strokeColor", COLOR),
    backgroundColor: reader.pattern("backgroundColor", COLOR),
    fillStyle: reader.oneOf("fillStyle", FILL_STYLES),
    strokeWidth: reader.number("strokeWidth", 0, 32),
    strokeStyle: reader.oneOf("strokeStyle", STROKE_STYLES),
    roundness: reader.nullable("roundness", (value, path) => {
      if (!isObject(value)) throw new Rejection(path, "notebook-invalid");
      const r = new Reader(value, path);
      const result = {
        type: r.integer("type", 1, 3),
        ...(() => {
          const v = r.optional("value", (x) => x.number("value", 0, C));
          return v === undefined ? {} : { value: v };
        })(),
      };
      r.close();
      return result;
    }),
    roughness: reader.number("roughness", 0, 2),
    opacity: reader.number("opacity", 0, 100),
    seed: reader.integer("seed", 0, 2 ** 31),
    version: reader.integer("version", 0, Number.MAX_SAFE_INTEGER),
    versionNonce: reader.integer("versionNonce", -(2 ** 31), 2 ** 32),
    index: reader.nullable("index", (value, path) => {
      if (typeof value !== "string" || !FRACTIONAL_INDEX.test(value))
        throw new Rejection(path, "notebook-invalid");
      return value;
    }),
    isDeleted: reader.boolean("isDeleted"),
    groupIds: [...(groupIds as string[])],
    frameId: null,
    boundElements: reader.nullable("boundElements", (value, path) => {
      if (!Array.isArray(value) || value.length > NOTEBOOK_LIMITS.maxBoundElements)
        throw new Rejection(path, "notebook-invalid");
      return value.map((item: unknown, index) => {
        const itemPath = `${path}[${String(index)}]`;
        if (!isObject(item)) throw new Rejection(itemPath, "notebook-invalid");
        const r = new Reader(item, itemPath);
        const result = { id: r.pattern("id", ELEMENT_ID), type: r.oneOf("type", ["arrow", "text"] as const) };
        r.close();
        return result;
      });
    }),
    updated: reader.number("updated", 0, Number.MAX_SAFE_INTEGER),
    link: null,
    locked: reader.boolean("locked"),
  };
}

function element(value: unknown, path: string, options: NotebookOptions): NotebookElement {
  if (!isObject(value)) throw new Rejection(path, "notebook-invalid");
  const type = value["type"];
  if (typeof type !== "string" || !(NOTEBOOK_ELEMENT_TYPES as readonly string[]).includes(type)) {
    throw new Rejection(`${path}.type`, "notebook-forbidden-type");
  }
  const reader = new Reader(value, path);
  reader.raw("type");
  const common = base(reader);
  let specific: Record<string, unknown> = {};
  switch (type as NotebookElementType) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      break;
    case "text": {
      const text = reader.text("text", NOTEBOOK_LIMITS.maxTextLength);
      specific = {
        text,
        originalText: reader.text("originalText", NOTEBOOK_LIMITS.maxTextLength),
        fontSize: reader.number("fontSize", 1, 400),
        fontFamily: reader.integer("fontFamily", 1, 10),
        textAlign: reader.oneOf("textAlign", TEXT_ALIGNS),
        verticalAlign: reader.oneOf("verticalAlign", VERTICAL_ALIGNS),
        containerId: reader.nullable("containerId", (v, p) => {
          if (typeof v !== "string" || !ELEMENT_ID.test(v)) throw new Rejection(p, "notebook-invalid");
          return v;
        }),
        autoResize: reader.boolean("autoResize"),
        lineHeight: reader.number("lineHeight", 0.5, 5),
      };
      break;
    }
    case "line":
    case "arrow": {
      specific = {
        points: points(reader.raw("points"), `${path}.points`, 2),
        lastCommittedPoint: reader.nullable("lastCommittedPoint", point),
        startBinding: reader.nullable("startBinding", binding),
        endBinding: reader.nullable("endBinding", binding),
        startArrowhead: reader.nullable("startArrowhead", (v, p) => {
          if (typeof v !== "string" || !(ARROWHEADS as readonly string[]).includes(v))
            throw new Rejection(p, "notebook-invalid");
          return v;
        }),
        endArrowhead: reader.nullable("endArrowhead", (v, p) => {
          if (typeof v !== "string" || !(ARROWHEADS as readonly string[]).includes(v))
            throw new Rejection(p, "notebook-invalid");
          return v;
        }),
      };
      if (type === "arrow") {
        specific["elbowed"] = reader.boolean("elbowed");
        const segments = reader.optional("fixedSegments", (r) =>
          r.nullable("fixedSegments", (v, p) => {
            if (!Array.isArray(v) || v.length > 100) throw new Rejection(p, "notebook-invalid");
            return v.map((item: unknown, index) => {
              const itemPath = `${p}[${String(index)}]`;
              if (!isObject(item)) throw new Rejection(itemPath, "notebook-invalid");
              const s = new Reader(item, itemPath);
              const result = {
                start: point(s.raw("start"), `${itemPath}.start`),
                end: point(s.raw("end"), `${itemPath}.end`),
                index: s.integer("index", 0, NOTEBOOK_LIMITS.maxPointsPerElement),
              };
              s.close();
              return result;
            });
          }),
        );
        if (segments !== undefined) specific["fixedSegments"] = segments;
        for (const key of ["startIsSpecial", "endIsSpecial"]) {
          const flag = reader.optional(key, (r) =>
            r.nullable(key, (v, p) => {
              if (typeof v !== "boolean") throw new Rejection(p, "notebook-invalid");
              return v;
            }),
          );
          if (flag !== undefined) specific[key] = flag;
        }
      }
      break;
    }
    case "freedraw": {
      const pressures = reader.raw("pressures");
      if (!Array.isArray(pressures) || pressures.length > NOTEBOOK_LIMITS.maxPointsPerElement) {
        throw new Rejection(`${path}.pressures`, "notebook-invalid");
      }
      for (const pressure of pressures) {
        if (typeof pressure !== "number" || !Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
          throw new Rejection(`${path}.pressures`, "notebook-invalid");
        }
      }
      specific = {
        points: points(reader.raw("points"), `${path}.points`, 1),
        pressures: [...(pressures as number[])],
        simulatePressure: reader.boolean("simulatePressure"),
        lastCommittedPoint: reader.nullable("lastCommittedPoint", point),
      };
      break;
    }
    case "image": {
      if (options.annotation === true) throw new Rejection(`${path}.type`, "notebook-image-forbidden");
      const fileId = reader.raw("fileId");
      // Une image ne référence qu'un média importé et réencodé pour CETTE copie (R14) : ni data:, ni URL.
      if (typeof fileId !== "string" || !NOTEBOOK_MEDIA_ID.test(fileId) || !options.mediaIds.has(fileId)) {
        throw new Rejection(`${path}.fileId`, "notebook-unknown-media");
      }
      const scale = point(reader.raw("scale"), `${path}.scale`);
      if (Math.abs(scale[0]) > 10 || Math.abs(scale[1]) > 10)
        throw new Rejection(`${path}.scale`, "notebook-invalid");
      specific = {
        fileId,
        status: reader.oneOf("status", IMAGE_STATUSES),
        scale,
        crop: reader.nullable("crop", (v, p) => {
          if (!isObject(v)) throw new Rejection(p, "notebook-invalid");
          const r = new Reader(v, p);
          const result = {
            x: r.number("x", -C, C),
            y: r.number("y", -C, C),
            width: r.number("width", 0, C),
            height: r.number("height", 0, C),
            naturalWidth: r.number("naturalWidth", 0, C),
            naturalHeight: r.number("naturalHeight", 0, C),
          };
          r.close();
          return result;
        }),
      };
      break;
    }
  }
  reader.close();
  return { type: type as NotebookElementType, ...common, ...specific };
}

function formula(value: unknown, path: string): NotebookFormula {
  if (!isObject(value)) throw new Rejection(path, "notebook-invalid");
  const reader = new Reader(value, path);
  const id = reader.pattern("id", ELEMENT_ID);
  const latex = reader.raw("latex");
  reader.close();
  // Même règle que les formules des cours (ADR-0011) : KaTeX strict, aucune commande à risque, aucun style.
  if (typeof latex !== "string" || checkLatex(latex, true) !== null)
    throw new Rejection(`${path}.latex`, "notebook-invalid-formula");
  return { id, latex };
}

/** Taille en octets UTF-8 du JSON d'une valeur. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Valide une scène du cahier contre le schéma fermé. */
export function validateNotebookScene(raw: unknown, options: NotebookOptions): NotebookValidation {
  try {
    if (!isObject(raw)) throw new Rejection("$", "notebook-invalid");
    const reader = new Reader(raw, "$");
    const elements = reader.raw("elements");
    const formulas = reader.optional("formulas", (r) => r.raw("formulas")) ?? [];
    reader.close();
    if (!Array.isArray(elements)) throw new Rejection("$.elements", "notebook-invalid");
    // Les limites de volume sont vérifiées AVANT d'examiner chaque élément (R15, M14).
    if (elements.length > NOTEBOOK_LIMITS.maxElements)
      throw new Rejection("$.elements", "notebook-too-many-elements");
    if (jsonByteLength(raw) > NOTEBOOK_LIMITS.maxBytes) throw new Rejection("$", "notebook-too-large");
    if (!Array.isArray(formulas) || formulas.length > NOTEBOOK_LIMITS.maxFormulas) {
      throw new Rejection("$.formulas", "notebook-invalid");
    }
    if (options.annotation === true && formulas.length > 0)
      throw new Rejection("$.formulas", "notebook-invalid");
    const value: NotebookScene = {
      elements: elements.map((item, index) => element(item, `$.elements[${String(index)}]`, options)),
      formulas: formulas.map((item, index) => formula(item, `$.formulas[${String(index)}]`)),
    };
    const ids = new Set(value.elements.map((item) => item.id));
    if (ids.size !== value.elements.length) throw new Rejection("$.elements", "notebook-invalid");
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Rejection) return { ok: false, problems: [{ path: error.path, code: error.code }] };
    throw error;
  }
}

/** Médias d'images référencés par une scène. */
export function notebookMediaIdsOf(scene: NotebookScene): string[] {
  return scene.elements.flatMap((item) =>
    item.type === "image" && typeof item["fileId"] === "string" ? [item["fileId"]] : [],
  );
}
