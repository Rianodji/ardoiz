import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  MainMenu,
  restoreElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { uploadNotebookImage } from "../api/assessment";
import { ErrorMessage } from "../components/ErrorMessage";
import { fileIdsOf, idsOf, toStoredElements } from "./sceneElements";

export type NotebookMode = "edit" | "annotate" | "view";

export interface NotebookCanvasProps {
  readonly mode: NotebookMode;
  /** Scène de l'élève (éléments stockés). */
  readonly elements: readonly unknown[];
  /** Calque du tuteur, superposé et verrouillé en lecture ; éditable en mode « annotate ». */
  readonly annotation?: readonly unknown[];
  /** Copie concernée : nécessaire pour importer une image en mode « edit ». */
  readonly attemptId?: string;
  /** En « edit » : la scène de l'élève ; en « annotate » : le seul calque du tuteur. */
  readonly onChange?: (elements: Record<string, unknown>[]) => void;
  readonly label: string;
}

const RED = "#e03131";
const GREEN = "#2f9e44";

/**
 * Adresse d'une image du cahier pour Excalidraw : la route autorisée de notre origine (R3), et non une
 * URL `data:` que la CSP refuse (img-src 'self'). Excalidraw charge l'image par cette adresse.
 */
const imageUrlOf = (fileId: string) => `/api/notebook-media/${encodeURIComponent(fileId)}`;

/**
 * Cahier virtuel (ADR-0004) : Excalidraw chargé à la demande. Aucune fonction qui contacte un tiers
 * (bibliothèques en ligne, partage, intégrations, IA) ; images seulement par import vers notre serveur.
 * En annotation, la scène de l'élève est verrouillée : seul le calque du tuteur change (R6).
 */
export default function NotebookCanvas({
  mode,
  elements,
  annotation = [],
  attemptId,
  onChange,
  label,
}: NotebookCanvasProps) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const studentIds = useRef(idsOf(elements));
  // Ce qui est déjà enregistré : le montage du canevas ne déclenche aucune sauvegarde.
  const lastSent = useRef<string>(
    JSON.stringify(mode === "annotate" ? toStoredElements(annotation) : toStoredElements(elements)),
  );
  const fileInput = useRef<HTMLInputElement>(null);

  // L'élève voit sa scène ; le tuteur et la vue corrigée y superposent le calque, verrouillé.
  const lockedStudent =
    mode === "edit" ? elements : elements.map((element) => ({ ...(element as object), locked: true }));
  const lockedAnnotation =
    mode === "annotate"
      ? annotation
      : annotation.map((element) => ({ ...(element as object), locked: true }));
  const initialElements = restoreElements([...lockedStudent, ...lockedAnnotation] as never, null);

  // Les images ne sont téléchargées que lorsque la liste des médias change, pas à chaque trait.
  const mediaKey = [...new Set(fileIdsOf(elements))].sort().join(",");
  useEffect(() => {
    const ids = mediaKey === "" ? [] : mediaKey.split(",");
    if (!ready || ids.length === 0) return;
    api.current?.addFiles(
      ids.map((id) => ({
        id,
        dataURL: imageUrlOf(id),
        mimeType: "image/webp",
        created: Date.now(),
      })) as never,
    );
  }, [mediaKey, ready]);

  const emit = (all: readonly unknown[]) => {
    if (onChange === undefined) return;
    const stored = toStoredElements(all);
    const own =
      mode === "annotate"
        ? stored.filter((element) => !studentIds.current.has(String(element["id"])))
        : stored;
    const serialized = JSON.stringify(own);
    if (serialized === lastSent.current) return; // déplacement du curseur, sélection : rien à enregistrer
    lastSent.current = serialized;
    onChange(own);
  };

  const stamp = (text: string, color: string) => {
    const current = api.current;
    if (current === null) return;
    const { scrollX, scrollY, width, height, zoom } = current.getAppState();
    const [element] = convertToExcalidrawElements([
      {
        type: "text",
        text,
        x: -scrollX + width / (2 * zoom.value),
        y: -scrollY + height / (2 * zoom.value),
        fontSize: 48,
        strokeColor: color,
      },
    ]);
    if (element === undefined) return;
    current.updateScene({
      elements: [...current.getSceneElements(), element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const addImage = async (file: File) => {
    const current = api.current;
    if (current === null || attemptId === undefined) return;
    const { mediaId, width, height } = await uploadNotebookImage(attemptId, file);
    current.addFiles([
      { id: mediaId, dataURL: imageUrlOf(mediaId), mimeType: "image/webp", created: Date.now() },
    ] as never);
    const scale = Math.min(1, 400 / Math.max(width, height));
    const { scrollX, scrollY } = current.getAppState();
    const [element] = convertToExcalidrawElements([
      {
        type: "image",
        fileId: mediaId as never,
        x: -scrollX + 40,
        y: -scrollY + 40,
        width: width * scale,
        height: height * scale,
        status: "saved",
      },
    ]);
    if (element === undefined) return;
    current.updateScene({
      elements: [...current.getSceneElements(), element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  return (
    <div className="notebook" role="group" aria-label={label}>
      {mode === "annotate" && (
        <div className="toolbar" role="toolbar" aria-label="Outils d'annotation">
          <button
            type="button"
            className="tool"
            onClick={() => {
              api.current?.updateScene({ appState: { currentItemStrokeColor: RED } });
              api.current?.setActiveTool({ type: "freedraw" });
            }}
          >
            Stylo rouge
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => {
              api.current?.updateScene({ appState: { currentItemStrokeColor: RED } });
              api.current?.setActiveTool({ type: "text" });
            }}
          >
            Texte
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => {
              stamp("✓", GREEN);
            }}
          >
            Tampon ✓
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => {
              stamp("✗", RED);
            }}
          >
            Tampon ✗
          </button>
        </div>
      )}
      {mode === "edit" && attemptId !== undefined && (
        <div className="toolbar" role="toolbar" aria-label="Outils du cahier">
          <button
            type="button"
            className="tool"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            Ajouter une photo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="visually-hidden"
            aria-label="Photo à ajouter au cahier"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) void addImage(file).catch(setError);
            }}
          />
        </div>
      )}
      <ErrorMessage error={error} />
      <div className="notebook-canvas">
        <Excalidraw
          excalidrawAPI={(instance) => {
            api.current = instance;
            setReady(true);
          }}
          initialData={{
            elements: initialElements,
            appState: {
              viewBackgroundColor: "#ffffff",
              currentItemStrokeColor: mode === "annotate" ? RED : "#1e1e1e",
              currentItemFontFamily: 5,
            },
            scrollToContent: true,
          }}
          onChange={(all) => {
            if (mode !== "view") emit(all);
          }}
          viewModeEnabled={mode === "view"}
          gridModeEnabled={mode === "edit"}
          langCode="fr-FR"
          aiEnabled={false}
          validateEmbeddable={false}
          onLinkOpen={(_element, event) => {
            event.preventDefault();
          }}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: mode === "edit",
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
        >
          <MainMenu>{mode === "edit" && <MainMenu.DefaultItems.ClearCanvas />}</MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
}
