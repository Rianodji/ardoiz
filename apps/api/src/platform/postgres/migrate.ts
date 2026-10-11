import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "pg";

const FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;
/** Clé du verrou consultatif : deux migrations simultanées (deux conteneurs) ne se chevauchent jamais. */
const ADVISORY_LOCK_KEY = 4_242_001;

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export async function readMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    const match = FILE_PATTERN.exec(name);
    if (match?.[1] === undefined) throw new MigrationError(`Nom de migration invalide : ${name}`);
    const sql = await readFile(join(directory, name), "utf8");
    files.push({ version: match[1], name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  const versions = files.map((file) => file.version);
  if (new Set(versions).size !== versions.length)
    throw new MigrationError("Deux migrations ont le même numéro.");
  return files;
}

/**
 * Applique, dans l'ordre et chacune dans sa transaction, les migrations pas encore appliquées.
 * Exécuté avec le rôle propriétaire, jamais avec le rôle de l'application (ADR-0002).
 * Une migration déjà livrée est immuable : si son contenu a changé, rien n'est appliqué.
 * Il n'existe pas de retour arrière : on corrige par une nouvelle migration (ADR-0008).
 */
export async function migrate(client: Client, directory: string): Promise<string[]> {
  const files = await readMigrations(directory);
  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version    text PRIMARY KEY CHECK (version ~ '^[0-9]{3}$'),
      name       text NOT NULL,
      checksum   text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM public.schema_migrations ORDER BY version",
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    const known = new Set(files.map((file) => file.version));

    for (const version of applied.keys()) {
      if (!known.has(version))
        throw new MigrationError(`Migration ${version} appliquée mais absente du dépôt.`);
    }
    for (const file of files) {
      const checksum = applied.get(file.version);
      // Migrations livrées immuables (règle 19 du prompt développeur).
      if (checksum !== undefined && checksum !== file.checksum) {
        throw new MigrationError(`La migration déjà appliquée ${file.name} a été modifiée.`);
      }
    }

    const newlyApplied: string[] = [];
    for (const file of files.filter((candidate) => !applied.has(candidate.version))) {
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query(
          "INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [file.version, file.name, file.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      newlyApplied.push(file.name);
    }
    return newlyApplied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
  }
}
