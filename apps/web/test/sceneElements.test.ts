import { validateNotebookScene } from "@ardoiz/content-schema";
import { describe, expect, it } from "vitest";
import { fileIdsOf, idsOf, toStoredElements } from "../src/notebook/sceneElements";

/** Élément tel qu'Excalidraw 0.18 le garde en mémoire, avec ses propriétés internes. */
const excalidrawRectangle = (id: string, extra: object = {}) => ({
  id,
  type: "rectangle",
  x: 1,
  y: 2,
  width: 30,
  height: 40,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roundness: { type: 3 },
  roughness: 1,
  opacity: 100,
  seed: 1,
  version: 4,
  versionNonce: 5,
  index: "a1",
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  updated: 1760000000000,
  link: null,
  locked: false,
  ...extra,
});

describe("Scène envoyée au serveur (ADR-0004)", () => {
  it("ne garde que les propriétés du schéma fermé : ni lien, ni donnée libre, ni élément effacé (R4)", () => {
    const stored = toStoredElements([
      excalidrawRectangle("r1", {
        link: "https://exemple.org",
        customData: { html: "<b>" },
        frameId: "cadre",
      }),
      excalidrawRectangle("r2", { isDeleted: true }),
      { ...excalidrawRectangle("e1"), type: "embeddable" },
    ]);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "r1", link: null, frameId: null });
    expect(stored[0]).not.toHaveProperty("customData");
    expect(validateNotebookScene({ elements: stored, formulas: [] }, { mediaIds: new Set() }).ok).toBe(true);
  });

  it("repère les identifiants et les images d'une scène", () => {
    const image = {
      ...excalidrawRectangle("i1"),
      type: "image",
      fileId: "nmd_01920000-0000-7000-8000-000000000001",
      status: "saved",
      scale: [1, 1],
      crop: null,
    };
    expect([...idsOf([excalidrawRectangle("r1"), image])]).toEqual(["r1", "i1"]);
    expect(fileIdsOf([image])).toEqual(["nmd_01920000-0000-7000-8000-000000000001"]);
  });
});
