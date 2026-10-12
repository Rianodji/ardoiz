import { NOTEBOOK_ELEMENT_TYPES, type NotebookElementType } from "@ardoiz/content-schema";

/**
 * Passage d'une scène Excalidraw au format stocké (ADR-0004) : on ne garde que les propriétés du
 * schéma fermé, sans lien ni donnée libre, et sans les éléments effacés. Le serveur valide de toute
 * façon : cette réduction évite seulement d'envoyer ce qu'il refuserait.
 */
const COMMON = [
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roundness",
  "roughness",
  "opacity",
  "seed",
  "version",
  "versionNonce",
  "index",
  "isDeleted",
  "groupIds",
  "boundElements",
  "updated",
  "locked",
] as const;

const SPECIFIC: Readonly<Record<NotebookElementType, readonly string[]>> = {
  rectangle: [],
  diamond: [],
  ellipse: [],
  text: [
    "text",
    "originalText",
    "fontSize",
    "fontFamily",
    "textAlign",
    "verticalAlign",
    "containerId",
    "autoResize",
    "lineHeight",
  ],
  line: ["points", "lastCommittedPoint", "startArrowhead", "endArrowhead"],
  arrow: ["points", "lastCommittedPoint", "startArrowhead", "endArrowhead", "elbowed"],
  freedraw: ["points", "pressures", "simulatePressure", "lastCommittedPoint"],
  image: ["fileId", "status", "scale", "crop"],
};

const OPTIONAL_ARROW = ["fixedSegments", "startIsSpecial", "endIsSpecial"] as const;

type Raw = Readonly<Record<string, unknown>>;

const isAllowedType = (type: unknown): type is NotebookElementType =>
  typeof type === "string" && (NOTEBOOK_ELEMENT_TYPES as readonly string[]).includes(type);

function binding(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Raw;
  return {
    elementId: raw["elementId"],
    focus: raw["focus"],
    gap: raw["gap"],
    ...(Array.isArray(raw["fixedPoint"]) || raw["fixedPoint"] === null
      ? { fixedPoint: raw["fixedPoint"] }
      : {}),
  };
}

function roundness(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Raw;
  return typeof raw["value"] === "number"
    ? { type: raw["type"], value: raw["value"] }
    : { type: raw["type"] };
}

/** Éléments stockés d'une scène : types autorisés, éléments non effacés, propriétés du schéma. */
export function toStoredElements(elements: readonly unknown[]): Raw[] {
  const stored: Raw[] = [];
  for (const element of elements) {
    if (typeof element !== "object" || element === null) continue;
    const raw = element as Raw;
    if (raw["isDeleted"] === true || !isAllowedType(raw["type"])) continue;
    const out: Record<string, unknown> = { frameId: null, link: null };
    for (const key of [...COMMON, ...SPECIFIC[raw["type"]]]) out[key] = raw[key];
    out["roundness"] = roundness(raw["roundness"]);
    out["index"] = typeof raw["index"] === "string" ? raw["index"] : null;
    out["boundElements"] = Array.isArray(raw["boundElements"])
      ? (raw["boundElements"] as Raw[]).map((bound) => ({ id: bound["id"], type: bound["type"] }))
      : null;
    if (raw["type"] === "line" || raw["type"] === "arrow") {
      out["startBinding"] = binding(raw["startBinding"]);
      out["endBinding"] = binding(raw["endBinding"]);
    }
    if (raw["type"] === "arrow") {
      for (const key of OPTIONAL_ARROW) if (key in raw) out[key] = raw[key] ?? null;
    }
    stored.push(out);
  }
  return stored;
}

/** Identifiants des éléments d'une scène : sert à séparer le calque du tuteur de la scène de l'élève. */
export const idsOf = (elements: readonly unknown[]): Set<string> =>
  new Set(
    elements.flatMap((element) =>
      typeof element === "object" && element !== null && typeof (element as Raw)["id"] === "string"
        ? [(element as Raw)["id"] as string]
        : [],
    ),
  );

/** Médias d'images d'une scène, à télécharger pour l'affichage. */
export const fileIdsOf = (elements: readonly unknown[]): string[] =>
  elements.flatMap((element) => {
    const raw = element as Raw;
    return raw["type"] === "image" && typeof raw["fileId"] === "string" ? [raw["fileId"]] : [];
  });
