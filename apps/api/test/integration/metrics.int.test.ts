import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/app/buildServer.js";
import { MetricsRegistry } from "../../src/platform/metrics/Metrics.js";
import { startMetricsServer } from "../../src/platform/metrics/metricsServer.js";
import { setupFamily, type Family } from "./support/families.js";
import { ADULT_PASSWORD, World, type Snapshot } from "./support/world.js";

/** Métriques Prometheus (L7) : port séparé, rien de public, aucune donnée d'un utilisateur. */
describe("Métriques", () => {
  let snapshot: Snapshot;
  let family: Family;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    snapshot = await base.freeze();
  });
  afterAll(async () => {
    await World.drop(snapshot.database);
  });
  beforeEach(async () => {
    world = await snapshot.fork();
  });
  afterEach(async () => {
    await world.close();
  });

  it("le port de l'application répond 404 sur /metrics, même quand il sert la SPA (ADR-0008)", async () => {
    const web = mkdtempSync(join(tmpdir(), "ardoiz-web-"));
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Ardoiz</title>");
    const app = await buildServer({
      config: {
        publicOrigin: "https://ardoiz.example.test",
        logLevel: "warn",
        trustedProxies: [],
        webDistDir: web,
      },
      readiness: () => Promise.resolve(true),
      metrics: new MetricsRegistry(),
    });
    try {
      const metrics = await app.inject({ method: "GET", url: "/metrics", headers: { accept: "text/html" } });
      expect(metrics.statusCode).toBe(404);
      expect(metrics.body).not.toContain("<!doctype html>");
      expect(metrics.body).not.toContain("ardoiz_http_requests_total");
      // La SPA reste servie pour une vraie page.
      expect((await app.inject({ method: "GET", url: "/eleve" })).body).toContain("<!doctype html>");
    } finally {
      await app.close();
    }
  });

  it("le serveur de métriques ne sert que GET /metrics, avec des routes en motif et sans identifiant", async () => {
    await world.http({
      method: "GET",
      url: `/api/learners/${family.learner.id}/progress`,
      cookie: family.learner.cookie,
    });
    await world.http({
      method: "POST",
      url: "/api/auth/login/adult",
      payload: { email: "tuteur@example.org", password: `${ADULT_PASSWORD}-faux` },
    });
    const server = await startMetricsServer(world.metrics, "127.0.0.1", 0);
    try {
      const { port } = server.address() as AddressInfo;
      const scrape = await fetch(`http://127.0.0.1:${String(port)}/metrics`);
      expect(scrape.status).toBe(200);
      const body = await scrape.text();
      expect(body).toContain('route="/api/learners/:learnerId/progress"');
      expect(body).not.toContain(family.learner.id);
      expect(body).not.toContain("tuteur@example.org");
      expect(body).toMatch(/ardoiz_login_failures_total\{reason="password"\} 1/);
      expect(body).toMatch(/ardoiz_http_request_duration_seconds_bucket\{.*le="\+Inf"\}/);
      expect(body).toContain("ardoiz_outbox_oldest_pending_seconds");
      expect((await fetch(`http://127.0.0.1:${String(port)}/healthz`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${String(port)}/metrics`, { method: "POST" })).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("compte les événements abandonnés, tous espaces confondus, sans rien dire de leur contenu (verdict L6 §5)", async () => {
    const before = await world.metrics.render();
    expect(before).toMatch(/^ardoiz_failed_events_dead 0$/m);
    const [space] = await world.adminQuery<{ id: string }>(
      "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
    );
    await world.adminQuery(
      `INSERT INTO messaging.failed_events (tutor_space_id, consumer, event_id, event_type, attempts, error_code, dead,
         first_failed_at, last_failed_at, next_attempt_at)
       VALUES ($1, 'progress', gen_random_uuid(), 'curriculum.lesson-completed', 5, 'Error', true, now(), now(), now())`,
      [space?.id],
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100)); // la collecte est mise en cache 1 s
    const after = await world.metrics.render();
    expect(after).toMatch(/^ardoiz_failed_events_dead 1$/m);
    expect(after).not.toContain(space?.id ?? "-");
  });
});
