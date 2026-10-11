import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { Secret } from "../../src/platform/config/Secret.js";
import { createPool, databaseReadiness } from "../../src/platform/postgres/pool.js";
import { inject } from "vitest";

describe("Sonde /readyz sur une vraie base", () => {
  const pool = createPool({ connectionString: new Secret(inject("appUrl")), max: 1 });
  afterAll(async () => {
    await pool.end();
  });

  it("répond vrai quand la base répond", async () => {
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
