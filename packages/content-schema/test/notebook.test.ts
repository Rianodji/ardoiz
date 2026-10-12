import { describe, expect, it } from "vitest";
import { NOTEBOOK_LIMITS, validateNotebookScene, type NotebookOptions } from "../src/index.js";

const MEDIA = "nmd_01920000-0000-7000-8000-000000000001";
const options = { mediaIds: new Set([MEDIA]) };

/** Propriétés communes, telles qu'Excalidraw 0.18 les produit. */
const common = (id: string) => ({
  id,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roundness: { type: 3 },
  roughness: 1,
  opacity: 100,
  seed: 1234,
  version: 3,
  versionNonce: 987,
  index: "a0",
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  updated: 1760000000000,
  link: null,
  locked: false,
});

const rectangle = (id = "r1") => ({ type: "rectangle", ...common(id) });
const freedraw = (id = "f1", count = 3) => ({
  type: "freedraw",
  ...common(id),
  roundness: null,
  points: Array.from({ length: count }, (_, i) => [i, i * 2]),
  pressures: [],
  simulatePressure: true,
  lastCommittedPoint: null,
});
const text = (value: string, id = "t1") => ({
  type: "text",
  ...common(id),
  roundness: null,
  text: value,
  originalText: value,
  fontSize: 20,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
});
const arrow = (id = "a1") => ({
  type: "arrow",
  ...common(id),
  roundness: { type: 2 },
  points: [
    [0, 0],
    [100, 50],
  ],
  lastCommittedPoint: null,
  startBinding: null,
  endBinding: { elementId: "r1", focus: 0.2, gap: 4 },
  startArrowhead: null,
  endArrowhead: "arrow",
  elbowed: false,
});
const image = (fileId: string) => ({
  type: "image",
  ...common("i1"),
  roundness: null,
  fileId,
  status: "saved",
  scale: [1, 1],
  crop: null,
});
const scene = (...elements: unknown[]) => ({ elements, formulas: [] });
const problemOf = (raw: unknown, opts: NotebookOptions = options) => {
  const result = validateNotebookScene(raw, opts);
  return result.ok ? null : result.problems[0]?.code;
};

describe("Scène du cahier : schéma fermé (ADR-0004)", () => {
  it("accepte chaque type autorisé et renvoie une copie identique, champ par champ", () => {
    const raw = scene(rectangle(), freedraw(), text("Aire = 12 cm²"), arrow(), image(MEDIA), {
      type: "ellipse",
      ...common("e1"),
    });
    const result = validateNotebookScene(raw, options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.elements).toEqual(raw.elements);
      expect(result.value.elements[0]).not.toBe(raw.elements[0]);
    }
  });

  it("garde un texte contenant du HTML ou du script comme du TEXTE, sans le transformer (R4)", () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    const result = validateNotebookScene(scene(text(payload)), options);
    expect(result.ok && result.value.elements[0]?.["text"]).toBe(payload);
  });

  it("refuse les caractères de contrôle et de direction dans un texte (R4)", () => {
    expect(problemOf(scene(text("a\u0000b")))).toBe("notebook-invalid");
    expect(problemOf(scene(text("abc‮def")))).toBe("notebook-invalid");
  });

  it("refuse toute clé inconnue, y compris customData (schéma fermé)", () => {
    expect(problemOf(scene({ ...rectangle(), customData: { x: 1 } }))).toBe("notebook-unknown-key");
    expect(problemOf(scene({ ...rectangle(), onclick: "alert(1)" }))).toBe("notebook-unknown-key");
    expect(problemOf({ ...scene(rectangle()), appState: {} })).toBe("notebook-unknown-key");
  });

  it("refuse tout lien sur un élément (R4)", () => {
    expect(problemOf(scene({ ...rectangle(), link: "javascript:alert(1)" }))).toBe("notebook-link-forbidden");
    expect(problemOf(scene({ ...rectangle(), link: "https://exemple.org" }))).toBe("notebook-link-forbidden");
  });

  it.each(["embeddable", "iframe", "frame", "magicframe", "selection", "script"])(
    "refuse le type « %s »",
    (type) => {
      expect(problemOf(scene({ ...rectangle(), type }))).toBe("notebook-forbidden-type");
    },
  );

  it("n'accepte une image que par référence à un média importé pour cette copie (R14)", () => {
    expect(problemOf(scene(image("data:image/png;base64,iVBORw0KGgo=")))).toBe("notebook-unknown-media");
    expect(problemOf(scene(image("https://exemple.org/a.png")))).toBe("notebook-unknown-media");
    expect(problemOf(scene(image("nmd_01920000-0000-7000-8000-000000000002")))).toBe(
      "notebook-unknown-media",
    );
    expect(problemOf(scene(image(MEDIA)), { mediaIds: new Set([MEDIA]), annotation: true })).toBe(
      "notebook-image-forbidden",
    );
  });

  it("refuse une couleur hors format et des nombres non finis ou démesurés", () => {
    expect(problemOf(scene({ ...rectangle(), strokeColor: "red;background:url(x)" }))).toBe(
      "notebook-invalid",
    );
    expect(problemOf(scene({ ...rectangle(), x: Number.NaN }))).toBe("notebook-invalid");
    expect(problemOf(scene({ ...rectangle(), x: 1e12 }))).toBe("notebook-invalid");
  });

  it("refuse deux éléments de même identifiant", () => {
    expect(problemOf(scene(rectangle("r1"), rectangle("r1")))).toBe("notebook-invalid");
  });

  it("valide les formules avec la même règle que les cours (ADR-0011)", () => {
    expect(
      validateNotebookScene({ elements: [], formulas: [{ id: "f1", latex: "\\frac{3}{4}" }] }, options).ok,
    ).toBe(true);
    expect(problemOf({ elements: [], formulas: [{ id: "f1", latex: "\\href{javascript:x}{y}" }] })).toBe(
      "notebook-invalid-formula",
    );
  });
});

describe("Limites d'une scène (R15)", () => {
  it("accepte 2 000 éléments et refuse 2 001 éléments (R15)", () => {
    const elements = Array.from({ length: NOTEBOOK_LIMITS.maxElements }, (_, i) =>
      rectangle(`r${String(i)}`),
    );
    expect(validateNotebookScene(scene(...elements), options).ok).toBe(true);
    expect(problemOf(scene(...elements, rectangle("r-de-trop")))).toBe("notebook-too-many-elements");
  });

  it("refuse une scène de plus de 5 Mo (R15)", () => {
    // 300 traits de 2 000 points ≈ 6 Mo de JSON.
    const elements = Array.from({ length: 300 }, (_, i) => freedraw(`f${String(i)}`, 2_000));
    expect(problemOf(scene(...elements))).toBe("notebook-too-large");
  });

  it("refuse un trait de plus de 20 000 points", () => {
    expect(problemOf(scene(freedraw("f1", 20_001)))).toBe("notebook-invalid");
  });
});
