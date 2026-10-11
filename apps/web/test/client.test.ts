import { describe, expect, it } from "vitest";
import { ApiError, apiFetch } from "../src/api/client";
import { messageFor } from "../src/api/messages";

const isStatus = (value: unknown): value is { status: string } =>
  typeof value === "object" && value !== null && "status" in value && typeof value.status === "string";

/** Serveur factice : renvoie une vraie `Response`, le client la lit comme celle du navigateur. */
const respondWith =
  (response: Response): typeof fetch =>
  () =>
    Promise.resolve(response);

const problem = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json" } });

describe("Client HTTP de la SPA", () => {
  it("renvoie le corps d'une réponse conforme au contrat", async () => {
    const response = new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(apiFetch("/healthz", isStatus, {}, respondWith(response))).resolves.toEqual({
      status: "ok",
    });
  });

  it("transforme un document RFC 9457 en ApiError avec son code et l'identifiant de requête", async () => {
    const body = {
      type: "about:blank",
      title: "Introuvable",
      status: 404,
      code: "application.not-found",
      requestId: "r-1",
    };
    const error = await apiFetch("/api/x", isStatus, {}, respondWith(problem(body, 404))).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "application.not-found", requestId: "r-1" });
  });

  it("ne fait jamais confiance au texte d'une erreur non conforme (R18)", async () => {
    const leaky = problem({ status: 500, detail: "relation users does not exist", stack: "…" }, 500);
    const error = await apiFetch("/api/x", isStatus, {}, respondWith(leaky)).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: "http.unexpected" });
    expect(messageFor(error)).not.toContain("relation");
  });

  it("refuse une réponse 200 qui ne respecte pas le contrat attendu", async () => {
    const response = new Response(JSON.stringify({ unexpected: true }), { status: 200 });
    await expect(apiFetch("/healthz", isStatus, {}, respondWith(response))).rejects.toMatchObject({
      code: "http.unexpected-response",
    });
  });

  it("signale une panne réseau par un code dédié", async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const error = await apiFetch("/healthz", isStatus, {}, offline).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: "network.unavailable" });
    expect(messageFor(error)).toContain("connexion internet");
  });

  it("envoie le corps en JSON, avec le cookie de la même origine seulement", async () => {
    let seen: RequestInit | undefined;
    const capture: typeof fetch = (_input, init) => {
      seen = init;
      return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    };
    await apiFetch("/api/x", isStatus, { method: "POST", body: { a: 1 } }, capture);
    expect(seen).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"a":1}' });
    expect(seen?.headers).toMatchObject({ "content-type": "application/json" });
  });
});

describe("Messages d'erreur affichés", () => {
  it("affiche un message générique pour un code inconnu, jamais le code brut", () => {
    expect(messageFor(new ApiError(422, "assessment.something-new"))).not.toContain("assessment");
  });
});
