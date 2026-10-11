import { Type, type Static } from "typebox";

/** Réponse de `/healthz` et `/readyz` : un état, sans aucun détail sur l'infrastructure. */
export const HealthStatus = Type.Object(
  { status: Type.Union([Type.Literal("ok"), Type.Literal("unavailable")]) },
  { additionalProperties: false },
);
export type HealthStatus = Static<typeof HealthStatus>;
