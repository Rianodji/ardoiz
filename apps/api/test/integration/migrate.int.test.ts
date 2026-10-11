import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, MigrationError } from "../../src/platform/postgres/migrate.js";
import { MIGRATIONS_DIR } from "./globalSetup.js";
import { ownerClient } from "./database.js";

describe("Outil de migration (migrations immuables)", () => {
  let owner: pg.Client;
  let copy: string;

  beforeAll(async () => {
    owner = await ownerClient();
    copy = await mkdtemp(join(tmpdir(), "ardoiz-migrations-"));
    await cp(MIGRATIONS_DIR, copy, { recursive: true });
  });
  afterAll(async () => {
    await owner.end();
    await rm(copy, { recursive: true });
  });

  it("ne réapplique rien sur une base à jour", async () => {
    expect(await migrate(owner, MIGRATIONS_DIR)).toEqual([]);
  });

  it("refuse de continuer si une migration déjà appliquée a été modifiée", async () => {
    await writeFile(join(copy, "001_socle.sql"), "-- modifiée après livraison\nSELECT 1;");
    await expect(migrate(owner, copy)).rejects.toThrow(MigrationError);
  });

  it("refuse un fichier de migration mal nommé", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ardoiz-migrations-"));
    await writeFile(join(dir, "2_sans_zeros.sql"), "SELECT 1;");
    await expect(migrate(owner, dir)).rejects.toThrow(/invalide/);
    await rm(dir, { recursive: true });
  });

  it("refuse une base qui connaît une migration absente du dépôt", async () => {
    const empty = await mkdtemp(join(tmpdir(), "ardoiz-migrations-"));
    await expect(migrate(owner, empty)).rejects.toThrow(/absente du dépôt/);
    await rm(empty, { recursive: true });
  });
});
