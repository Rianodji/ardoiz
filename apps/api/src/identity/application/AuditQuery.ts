import type { Actor } from "./Actor.js";
import { canReadAuditTrail } from "./policies.js";
import type { AuditRecord } from "./ports.js";
import { authorize, type IdentityDependencies } from "./support.js";

/** Nombre d'entrées affichées : assez pour une enquête, borné pour la réponse (R15). */
export const AUDIT_PAGE_SIZE = 200;

/** Consultation du journal d'audit : le tuteur de l'espace seulement (matrice des droits). */
export class AuditQuery {
  constructor(private readonly deps: IdentityDependencies) {}

  async latest(actor: Actor): Promise<AuditRecord[]> {
    await authorize(this.deps, actor, canReadAuditTrail(actor), "identity.read-audit");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.latestAudit(AUDIT_PAGE_SIZE));
  }
}
