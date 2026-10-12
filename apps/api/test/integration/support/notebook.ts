import { expect } from "vitest";
import { assign, createAssessment, type LearnerAttempt } from "./assessment.js";
import type { Family } from "./families.js";
import type { HttpResult, World } from "./world.js";

/** Propriétés communes d'un élément, telles qu'Excalidraw 0.18 les produit. */
const common = (id: string, x = 0, y = 0) => ({
  id,
  x,
  y,
  width: 100,
  height: 100,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roundness: null,
  roughness: 1,
  opacity: 100,
  seed: 4242,
  version: 2,
  versionNonce: 17,
  index: "a0",
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  updated: 1_760_000_000_000,
  link: null,
  locked: false,
});

/** Un triangle tracé à la ligne brisée fermée. */
export const triangle = () => ({
  type: "line",
  ...common("triangle-1", 10, 10),
  points: [
    [0, 0],
    [100, 0],
    [0, 80],
    [0, 0],
  ],
  lastCommittedPoint: null,
  startBinding: null,
  endBinding: null,
  startArrowhead: null,
  endArrowhead: null,
});

export const rectangle = (id: string) => ({ type: "rectangle", ...common(id) });

export const textElement = (id: string, text: string, color = "#1e1e1e") => ({
  type: "text",
  ...common(id, 20, 120),
  strokeColor: color,
  text,
  originalText: text,
  fontSize: 20,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
});

export const imageElement = (fileId: string) => ({
  type: "image",
  ...common("image-1"),
  fileId,
  status: "saved",
  scale: [1, 1],
  crop: null,
});

/** Épreuve « Géométrie : tracer un triangle » : une question de type cahier, notée sur 5. */
export async function notebookAssessment(
  world: World,
  family: Family,
  title = "Géométrie : tracer un triangle",
) {
  const { assessmentId } = await createAssessment(
    world,
    family.tutor.cookie,
    title,
    ([competencyId = ""]) => [
      {
        kind: "notebook",
        prompt: "Trace un triangle rectangle.",
        points: 5,
        competencyIds: [competencyId],
        modelAnswer: "TEMOIN-MODELE-CAHIER",
      },
    ],
  );
  const assignmentId = await assign(world, family.tutor.cookie, assessmentId, {
    learnerId: family.learner.id,
  });
  return { assessmentId, assignmentId };
}

export const notebookAnswer = (attempt: LearnerAttempt, elements: unknown[], formulas: unknown[] = []) => ({
  [attempt.questions[0]?.id ?? ""]: { kind: "notebook", elements, formulas },
});

export async function saveScene(world: World, cookie: string, attempt: LearnerAttempt, elements: unknown[]) {
  return world.http({
    method: "PUT",
    url: `/api/attempts/${attempt.attemptId}/answers`,
    cookie,
    payload: { answers: notebookAnswer(attempt, elements) },
  });
}

/** Envoi d'octets bruts, comme le navigateur pour l'import d'une image dans le cahier. */
export async function uploadNotebookImage(
  world: World,
  cookie: string,
  attemptId: string,
  bytes: Buffer,
): Promise<HttpResult> {
  const response = await world.app.inject({
    method: "POST",
    url: `/api/attempts/${attemptId}/media`,
    headers: { origin: "https://ardoiz.example.test", "content-type": "application/octet-stream", cookie },
    payload: bytes,
  });
  return {
    status: response.statusCode,
    headers: response.headers,
    body: response.body === "" ? null : (JSON.parse(response.body) as unknown),
    setCookie: undefined,
  };
}

export function expectStatus(res: HttpResult, status: number): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}
