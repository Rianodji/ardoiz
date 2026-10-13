import pg from "pg";
import type { Secret } from "../config/Secret.js";

export interface PoolOptions {
  readonly connectionString: Secret;
  readonly max: number;
}

/**
 * Pool de connexions du rôle d'exécution (soumis à la RLS, R10). Délais bornés : une base lente
 * produit une erreur, donc un refus, jamais une attente infinie (R18).
 *
 * Une connexion INACTIVE coupée par la base (redémarrage, arrêt d'un processus serveur) émet une
 * erreur sur le pool : sans écouteur, Node arrête toute l'application. Le pool écarte déjà la
 * connexion fautive ; on se contente de le signaler (code seulement) et la requête suivante en ouvre
 * une autre (L7, découvert par l'E2E contre l'image).
 */
export function createPool(options: PoolOptions, onIdleError: (code: string) => void): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString.reveal(),
    max: options.max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    application_name: "ardoiz-api",
  });
  pool.on("error", (error: Error & { code?: unknown }) => {
    onIdleError(typeof error.code === "string" ? error.code : error.name);
  });
  return pool;
}

/** Sonde `/readyz` : une requête triviale, avec le délai du pool. */
export function databaseReadiness(pool: pg.Pool): () => Promise<boolean> {
  return async () => {
    const result = await pool.query<{ ok: number }>("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  };
}
