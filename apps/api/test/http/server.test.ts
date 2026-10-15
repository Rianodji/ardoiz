import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer, DEFAULT_BODY_LIMIT, type ServerConfig } from "../../src/app/buildServer.js";
import type { ReadinessProbe } from "../../src/platform/http/health.js";
import { REDACTED } from "../../src/platform/logging/logger.js";
import { ForbiddenError, NotFoundError } from "../../src/shared-kernel/DomainError.js";
import { captureLogs } from "../support/logs.js";

const ORIGIN = "https://ardoiz.example.test";
const config: ServerConfig = { publicOrigin: ORIGIN, logLevel: "info", trustedProxies: [] };

/**
 * Route d'essai ajoutée par le test pour exercer la plateforme HTTP : schéma strict,
 * corps JSON, et erreurs levées à la demande. Aucune route métier n'existe encore au lot L0.
 */
function addProbeRoutes(app: FastifyInstance): void {
  const body = Type.Object({ name: Type.String({ maxLength: 50 }) }, { additionalProperties: false });
  app.post<{ Body: { name: string } }>("/api/probe", { schema: { body } }, (request, reply) =>
    reply.send({ received: request.body.name }),
  );
  app.get("/api/probe/hidden", () => {
    throw new NotFoundError();
  });
  app.get("/api/probe/forbidden", () => {
    throw new ForbiddenError("tutor-only");
  });
  app.get("/api/probe/method", () => {
    throw Object.assign(new Error("Method Not Allowed"), { statusCode: 405 });
  });
  app.get("/api/probe/limited", () => {
    throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429, retryAfter: 30 });
  });
  app.get("/api/probe/limited-default", () => {
    throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
  });
  app.get("/api/probe/ip", (request, reply) => reply.send({ ip: request.ip }));
  app.get("/api/probe/crash", () => {
    throw new Error('relation "identity.accounts" does not exist at character 42');
  });
}

describe("Serveur HTTP (plateforme L0)", () => {
  let app: FastifyInstance;
  let logs: ReturnType<typeof captureLogs>;
  let readiness: ReadinessProbe;

  beforeEach(async () => {
    logs = captureLogs();
    readiness = () => Promise.resolve(true);
    app = await buildServer({ config, readiness: () => readiness(), logStream: logs.stream });
    addProbeRoutes(app);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const post = (payload: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/probe",
      headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
      payload,
    });

  describe("En-têtes de sécurité (R11)", () => {
    it("pose la CSP stricte et les en-têtes de durcissement sur une réponse de l'API (R11)", async () => {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      const csp = res.headers["content-security-policy"];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).toContain("frame-src https://www.youtube-nocookie.com");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(res.headers).toMatchObject({
        "strict-transport-security": "max-age=63072000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        "x-frame-options": "DENY",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "no-store",
      });
      expect(res.headers["permissions-policy"]).toContain("camera=()");
      expect(res.headers["permissions-policy"]).toContain("geolocation=()");
      expect(res.headers).not.toHaveProperty("x-powered-by");
    });

    it("pose aussi les en-têtes sur une réponse d'erreur (R11)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/inexistant" });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("n'émet jamais d'en-tête CORS, même pour une origine tierce (R11, ADR-0006)", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/api/probe",
        headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
      });
      expect(res.headers).not.toHaveProperty("access-control-allow-origin");
      expect(res.headers).not.toHaveProperty("access-control-allow-credentials");
    });
  });

  describe("Vérification de l'origine des écritures (R11, M15)", () => {
    it("accepte une écriture venant de notre origine (R11)", async () => {
      const res = await post(JSON.stringify({ name: "Lina" }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: "Lina" });
    });

    it.each([
      ["depuis une origine étrangère", { origin: "https://evil.example" }],
      ["depuis un sous-domaine voisin", { origin: "https://evil.ardoiz.example.test" }],
      ["depuis la même machine en HTTP", { origin: "http://ardoiz.example.test" }],
      ["avec l'origine « null »", { origin: "null" }],
    ])("refuse un POST %s (R11)", async (_label, headers) => {
      const res = await post(JSON.stringify({ name: "Lina" }), headers);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ status: 403, code: "http.origin-rejected" });
    });

    it("refuse un POST sans en-tête Origin (R11)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/probe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "Lina" }),
      });
      expect(res.statusCode).toBe(403);
    });

    it.each(["PUT", "PATCH", "DELETE"] as const)(
      "refuse aussi un %s d'une origine étrangère (R11)",
      async (method) => {
        const res = await app.inject({
          method,
          url: "/api/probe",
          headers: { origin: "https://evil.example" },
        });
        expect(res.statusCode).toBe(403);
      },
    );
  });

  describe("Validation et limites des entrées (règle 5, R15)", () => {
    it("rejette un champ supplémentaire (affectation de masse) en RFC 9457", async () => {
      const res = await post(JSON.stringify({ name: "Lina", tutorSpaceId: "tsp_autre" }));
      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json()).toMatchObject({ status: 400, code: "http.invalid-request" });
    });

    it("rejette un type inattendu sans le convertir", async () => {
      const res = await post(JSON.stringify({ name: 42 }));
      expect(res.statusCode).toBe(400);
    });

    it("rejette un JSON mal formé", async () => {
      const res = await post('{"name": "Lina"');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: "http.invalid-request" });
    });

    it("refuse un corps de plus de 1 Mio (R15)", async () => {
      const res = await post(JSON.stringify({ name: "x".repeat(DEFAULT_BODY_LIMIT) }));
      expect(res.statusCode).toBe(413);
      expect(res.json()).toMatchObject({ status: 413, code: "http.payload-too-large" });
    });

    it("refuse tout autre type de contenu que JSON (R11)", async () => {
      const res = await post("name=Lina", { "content-type": "text/plain" });
      expect(res.statusCode).toBe(415);
      expect(res.json()).toMatchObject({ code: "http.unsupported-media-type" });
    });
  });

  describe("Erreurs RFC 9457 en mode fermé (R18)", () => {
    it("répond 404 pour une ressource masquée, avec un identifiant de requête (R2)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/probe/hidden" });
      expect(res.statusCode).toBe(404);
      const { requestId, ...problem } = res.json<{ requestId: string }>();
      expect(problem).toEqual({
        type: "about:blank",
        title: "Ressource introuvable",
        status: 404,
        code: "application.not-found",
      });
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("répond 403 pour un refus visible, sans révéler la raison interne", async () => {
      const res = await app.inject({ method: "GET", url: "/api/probe/forbidden" });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("tutor-only");
    });

    it("transforme une erreur inattendue en 500 générique ; le détail ne va qu'au journal (R18)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/probe/crash" });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("identity.accounts");
      const body = res.json<{ code: string; requestId: string }>();
      expect(body.code).toBe("internal-error");
      expect(logs.text()).toContain("identity.accounts");
      expect(logs.text()).toContain(body.requestId);
    });

    it("traduit un 405 technique en code stable, pas en 500 (réserve R-4)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/probe/method" });
      expect(res.statusCode).toBe(405);
      expect(res.json()).toMatchObject({ status: 405, code: "http.method-not-allowed" });
    });

    it("traduit un 429 en code stable avec l'en-tête Retry-After annoncé (réserve R-4)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/probe/limited" });
      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ status: 429, code: "http.too-many-requests" });
      expect(res.headers["retry-after"]).toBe("30");
    });

    it("pose un Retry-After par défaut quand l'erreur 429 n'en annonce pas (réserve R-4)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/probe/limited-default" });
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBe("60");
    });

    it("ignore un identifiant de requête fourni par le client", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/probe/hidden",
        headers: { "request-id": "forge" },
      });
      expect(res.json<{ requestId: string }>().requestId).not.toBe("forge");
    });
  });

  describe("Sondes de santé", () => {
    it("/healthz répond tant que le processus vit", async () => {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.json()).toEqual({ status: "ok" });
    });

    it("/readyz répond 200 quand la base répond", async () => {
      const res = await app.inject({ method: "GET", url: "/readyz" });
      expect(res.statusCode).toBe(200);
    });

    it("/readyz répond 503 quand la sonde échoue, sans dire pourquoi (panne simulée, R18)", async () => {
      readiness = () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
      const res = await app.inject({ method: "GET", url: "/readyz" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "unavailable" });
      expect(res.body).not.toContain("10.0.0.5");
      expect(logs.text()).toContain("ECONNREFUSED");
    });
  });

  describe("Journaux de requêtes (R21)", () => {
    it("journalise l'identifiant de requête mais ni le cookie ni un jeton passé dans l'URL (R21)", async () => {
      await app.inject({
        method: "GET",
        url: "/api/invitations/accept?token=jeton-invitation-secret",
        headers: { cookie: "__Host-ardoiz=identifiant-de-session-secret" },
      });
      const text = logs.text();
      expect(text).toContain("requestId");
      expect(text).toContain("/api/invitations/accept");
      expect(text).not.toContain("jeton-invitation-secret");
      expect(text).not.toContain("identifiant-de-session-secret");
      expect(text).toContain(`?${REDACTED}`);
    });
  });
});

describe("Service de la SPA sur la même origine (ADR-0006)", () => {
  let app: FastifyInstance;
  let dist: string;

  beforeEach(async () => {
    dist = await mkdtemp(join(tmpdir(), "ardoiz-web-"));
    await mkdir(join(dist, "assets"));
    await writeFile(
      join(dist, "index.html"),
      '<!doctype html><script type="module" src="/assets/app.js"></script>',
    );
    await writeFile(join(dist, "assets", "app.js"), "export {};");
    app = await buildServer({
      config: { ...config, webDistDir: dist },
      readiness: () => Promise.resolve(true),
      logStream: captureLogs().stream,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(dist, { recursive: true });
  });

  it("sert index.html avec la CSP pour toute navigation, et le routeur du front décide (R11)", async () => {
    const res = await app.inject({ method: "GET", url: "/eleve/cours" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("répond aussi à HEAD sur une navigation, comme à GET, avec les mêmes en-têtes (L8, correction 5)", async () => {
    for (const url of ["/", "/eleve/cours"]) {
      const get = await app.inject({ method: "GET", url });
      const head = await app.inject({ method: "HEAD", url });
      expect(head.statusCode, url).toBe(200);
      expect(head.body, url).toBe("");
      expect(head.headers["content-type"], url).toBe(get.headers["content-type"]);
      expect(head.headers["content-security-policy"], url).toBe(get.headers["content-security-policy"]);
      expect(head.headers["cache-control"], url).toBe("no-store");
    }
  });

  it("garde un 404 RFC 9457 pour HEAD sur une route d'API inconnue (L8, correction 5)", async () => {
    const res = await app.inject({ method: "HEAD", url: "/api/inconnue" });
    expect(res.statusCode).toBe(404);
  });

  it("refuse toujours les autres méthodes hors API sur une navigation (L8, correction 5)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/eleve",
      headers: { origin: config.publicOrigin },
    });
    expect(res.statusCode).toBe(404);
  });

  it("met en cache les fichiers à empreinte, jamais la page", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("répond en RFC 9457 pour une route d'API inconnue, pas avec la page", async () => {
    const res = await app.inject({ method: "GET", url: "/api/inconnue" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("Adresse du client derrière Traefik (réserve R-3, préalable à R8)", () => {
  const ipSeenWith = async (trustedProxies: string[], remoteAddress = "10.0.0.2"): Promise<string> => {
    const app = await buildServer({
      config: { ...config, trustedProxies },
      readiness: () => Promise.resolve(true),
      logStream: captureLogs().stream,
    });
    addProbeRoutes(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/probe/ip",
      remoteAddress,
      headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.9" },
    });
    await app.close();
    return res.json<{ ip: string }>().ip;
  };

  it("sans mandataire de confiance, ignore X-Forwarded-For (un client ne choisit pas son adresse)", async () => {
    expect(await ipSeenWith([])).toBe("10.0.0.2");
  });

  it("derrière Traefik (réseau de confiance), retient l'adresse ajoutée par Traefik, pas celle forgée par le client", async () => {
    expect(await ipSeenWith(["10.0.0.0/24"])).toBe("203.0.113.9");
  });

  it("ignore X-Forwarded-For envoyé directement par un client hors du réseau de confiance", async () => {
    expect(await ipSeenWith(["10.0.0.0/24"], "198.51.100.50")).toBe("198.51.100.50");
  });
});
