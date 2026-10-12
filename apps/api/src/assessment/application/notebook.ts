import { jsonByteLength, validateNotebookScene, type NotebookScene } from "@ardoiz/content-schema";
import type { QuestionId } from "../../shared-kernel/ids.js";
import { InvalidNotebookError } from "../domain/errors.js";
import type { ContentHasher, StoredScene } from "./ports.js";
import { canonicalJson } from "./support.js";

/** Scène reçue du navigateur : éléments Excalidraw et formules, encore à valider. */
export interface RawNotebook {
  readonly elements: readonly unknown[];
  readonly formulas?: readonly unknown[];
}

/** Au plus 20 images importées par copie (R15, M13). QUESTION Q20 : borne non fixée par R15 ; option restrictive. */
export const MAX_NOTEBOOK_IMAGES = 20;

/**
 * Valide une scène contre le schéma fermé (ADR-0004, R4, R14, R15), puis calcule son empreinte et sa
 * taille sur le JSON canonique : la même scène donne toujours la même empreinte (R6).
 */
export function storedScene(
  hasher: ContentHasher,
  questionId: QuestionId,
  raw: RawNotebook,
  options: { readonly mediaIds: ReadonlySet<string>; readonly annotation?: boolean },
): StoredScene {
  const validation = validateNotebookScene(
    { elements: raw.elements, formulas: raw.formulas ?? [] },
    { mediaIds: options.mediaIds, ...(options.annotation === true ? { annotation: true } : {}) },
  );
  if (!validation.ok) {
    const code = validation.problems[0]?.code;
    throw new InvalidNotebookError(
      code === "notebook-too-many-elements" || code === "notebook-too-large"
        ? "assessment.notebook-too-large"
        : "assessment.invalid-notebook",
    );
  }
  const scene: NotebookScene = validation.value;
  const canonical = canonicalJson(scene);
  return { questionId, scene, sha256: hasher.sha256(canonical), byteSize: jsonByteLength(scene) };
}
