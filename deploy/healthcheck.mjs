// HEALTHCHECK de l'image : l'image distroless n'a ni shell ni curl, Node fait la requête.
// Vivant = /healthz répond 200 en moins de 3 s sur le port de l'application.
const port = process.env.PORT ?? "3000";
try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3_000) });
  process.exit(response.status === 200 ? 0 : 1);
} catch {
  process.exit(1);
}
