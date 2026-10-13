import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { Secret } from "../../src/platform/config/Secret.js";
import { createPool, databaseReadiness } from "../../src/platform/postgres/pool.js";
import { inject } from "vitest";

describe("Sonde /readyz sur une vraie base", () => {
  const idleErrors: string[] = [];
  const pool = createPool({ connectionString: new Secret(inject("appUrl")), max: 1 }, (code) => {
    idleErrors.push(code);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("répond vrai quand la base répond", async () => {
    expect(await databaseReadiness(pool)()).toBe(true);
  });

  it("une connexion inactive coupée par la base n'arrête pas l'application ; la suivante est rouverte (L7)", async () => {
    expect(await databaseReadiness(pool)()).toBe(true); // une connexion inactive reste dans le pool
    const admin = new pg.Client({ connectionString: inject("adminRootUrl") });
    await admin.connect();
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'ardoiz_user' AND application_name = 'ardoiz-api'",
    );
    await admin.end();
    await expect.poll(() => idleErrors.length).toBeGreaterThan(0);
    expect(idleErrors[0]).toBe("57P01");
    expect(await databaseReadiness(pool)()).toBe(true);
  });

  it("lève une erreur quand la base est injoignable, donc « indisponible » (R18)", async () => {
    const unreachable = new pg.Pool({
      connectionString: "postgres://ardoiz_user:x@127.0.0.1:1/ardoiz",
      connectionTimeoutMillis: 500,
    });
    await expect(databaseReadiness(unreachable)()).rejects.toThrow();
    await unreachable.end();
  });
});
