import type { AuditAction } from "./auditActions.js";
import type { AuditEntryId, TutorSpaceId } from "./ids.js";

export type AuditOutcome = "success" | "denied" | "failed";

/** Auteur d'une action auditée : un compte de l'espace, ou un composant du système. */
export type AuditActor =
  { readonly kind: "tutor" | "guardian" | "learner"; readonly id: string } | { readonly kind: "system" };

/**
 * Entrée du journal d'audit (R12) : qui a fait quoi, sur quoi, avec quel résultat.
 * Uniquement des identifiants opaques et des codes : aucune donnée personnelle, aucun texte libre (R21).
 */
export interface AuditEntry {
  readonly id: AuditEntryId;
  readonly tutorSpaceId: TutorSpaceId;
  readonly action: AuditAction;
  readonly actor: AuditActor;
  readonly targetId?: string;
  readonly outcome: AuditOutcome;
  readonly reasonCode?: string;
  readonly occurredAt: Date;
}

/** Port de sortie : journal durable en ajout seul, distinct des journaux techniques. */
export interface AuditTrail {
  record(entry: AuditEntry): Promise<void>;
}
