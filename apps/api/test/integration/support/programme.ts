import sharp from "sharp";
import { expect } from "vitest";
import type { Family } from "./families.js";
import type { HttpResult, World } from "./world.js";

/** Image de test : un petit PNG uni. */
export function pngImage(width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 90 } } })
    .png()
    .toBuffer();
}

/** Envoi d'octets bruts, comme le navigateur pour l'import d'une image. */
export async function uploadImage(
  world: World,
  cookie: string,
  lessonId: string,
  bytes: Buffer,
): Promise<HttpResult> {
  const response = await world.app.inject({
    method: "POST",
    url: `/api/lessons/${lessonId}/media`,
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

export const lessonContent = (mediaId: string) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Convertir des longueurs" }] },
    { type: "paragraph", content: [{ type: "text", text: "1 m = 100 cm." }] },
    { type: "image", attrs: { mediaId, alt: "Une règle graduée" } },
  ],
});

export interface Programme {
  readonly subjectId: string;
  readonly moduleId: string;
  readonly lessonId: string;
  readonly mediaId: string;
  readonly groupId: string;
}

/**
 * Le programme type du feature deverrouillage : un cours publié « Convertir des longueurs », avec
 * une image, dans un module de mathématiques ; le groupe « Neveux 5e » contient Lina et Noé.
 */
export async function setupProgramme(world: World, family: Family): Promise<Programme> {
  const tutor = family.tutor.cookie;
  const referential = await world.http({ method: "GET", url: "/api/referential", cookie: tutor });
  const subjects = (referential.body as { subjects: Array<{ id: string; name: string }> }).subjects;
  const subjectId = subjects.find((subject) => subject.name === "Mathématiques")?.id ?? "";
  const created = async (url: string, payload: object): Promise<string> => {
    const res = await world.http({ method: "POST", url, cookie: tutor, payload });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { id: string }).id;
  };
  const moduleId = await created("/api/modules", { subjectId, title: "Grandeurs et mesures" });
  const lessonId = await created("/api/lessons", { moduleId, title: "Convertir des longueurs" });
  const upload = await uploadImage(world, tutor, lessonId, await pngImage());
  expect(upload.status, JSON.stringify(upload.body)).toBe(201);
  const mediaId = (upload.body as { mediaId: string }).mediaId;
  const saved = await world.http({
    method: "PUT",
    url: `/api/lessons/${lessonId}/content`,
    cookie: tutor,
    payload: { content: lessonContent(mediaId) },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(204);
  expect(
    (await world.http({ method: "POST", url: `/api/lessons/${lessonId}/publish`, cookie: tutor })).status,
  ).toBe(204);
  const groupId = await created("/api/groups", { name: "Neveux 5e" });
  const members = await world.http({
    method: "PUT",
    url: `/api/groups/${groupId}/members`,
    cookie: tutor,
    payload: { learnerIds: [family.learner.id, family.otherLearner.id] },
  });
  expect(members.status).toBe(204);
  return { subjectId, moduleId, lessonId, mediaId, groupId };
}

export async function unlock(
  world: World,
  tutorCookie: string,
  target: { kind: string; id: string },
  audience: { kind: string; id: string },
): Promise<string> {
  const res = await world.http({
    method: "POST",
    url: "/api/unlocks",
    cookie: tutorCookie,
    payload: { target, audience },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}
