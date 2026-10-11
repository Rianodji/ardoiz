import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/app/buildServer.js";
import { toUuid } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../src/platform/postgres/withTenantTransaction.js";
import type { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import { captureLogs } from "../support/logs.js";
import { appPool, clock, createTutorSpace } from "./database.js";

describe("Journalisation d'une vraie erreur Postgres (R21, réserve R-2)", () => {
  let pool: pg.Pool;
  let space: TutorSpaceId;

  beforeAll(async () => {
    pool = appPool();
    space = await createTutorSpace(pool, "Espace doublon");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("une violation d'unicité ne fait fuir la valeur ni dans la réponse ni dans le journal (R21)", async () => {
    const logs = captureLogs();
    const app = await buildServer({
      config: { publicOrigin: "https://ardoiz.example.test", logLevel: "info", trustedProxies: [] },
      readiness: () => Promise.resolve(true),
      logStream: logs.stream,
    });
    // Insère une seconde fois le même espace : Postgres répond 23505 avec « Key (id)=(…) already exists. »
    app.get("/api/probe/duplicate", () =>
      withTenantTransaction(pool, space, (client) =>
        client.query("INSERT INTO tenancy.tutor_spaces (id, name, created_at) VALUES ($1, 'doublon', $2)", [
          toUuid(space),
          clock.now(),
        ]),
      ),
    );
    const res = await app.inject({ method: "GET", url: "/api/probe/duplicate" });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(toUuid(space));
    const text = logs.text();
    expect(text).toContain('"code":"23505"');
    expect(text).toContain('"constraint":"tutor_spaces_pkey"');
    expect(text).not.toContain(toUuid(space)); // la valeur en conflit, présente dans `detail`
    expect(text).not.toContain("already exists");
  });
});
