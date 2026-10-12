import type { Actor } from "../../identity/index.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import { enforce, type Decision } from "../../shared-kernel/Decision.js";
import type { IdGenerator } from "../../shared-kernel/ids.js";
import type { CurriculumGateway, FileStorage, ImageIngestion } from "./ports.js";

export interface CurriculumDependencies {
  readonly gateway: CurriculumGateway;
  readonly files: FileStorage;
  readonly images: ImageIngestion;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export function auditOf(
  deps: Pick<CurriculumDependencies, "ids" | "clock">,
  actor: Actor,
  action: string,
  outcome: AuditEntry["outcome"],
  details: { targetId?: string; reasonCode?: string } = {},
): AuditEntry {
  return {
    id: deps.ids.next("AuditEntryId"),
    tutorSpaceId: actor.tutorSpaceId,
    action,
    actor: { kind: actor.kind, id: actor.id },
    outcome,
    occurredAt: deps.clock.now(),
    ...(details.targetId === undefined ? {} : { targetId: details.targetId }),
    ...(details.reasonCode === undefined ? {} : { reasonCode: details.reasonCode }),
  };
}

/** Applique une décision ; un refus est journalisé dans sa propre transaction (R12), puis levé (R2, R18). */
export async function authorize(
  deps: Pick<CurriculumDependencies, "gateway" | "ids" | "clock">,
  actor: Actor,
  decision: Decision,
  action: string,
  targetId?: string,
): Promise<void> {
  if (decision.kind !== "allow") {
    const entry = auditOf(deps, actor, action, "denied", {
      reasonCode: decision.kind === "hide" ? "hidden" : decision.reason,
      ...(targetId === undefined ? {} : { targetId }),
    });
    await deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.audit(entry));
  }
  enforce(decision);
}
