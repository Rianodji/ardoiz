import type { Actor } from "../../identity/index.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { Clock, RandomSource } from "../../shared-kernel/Clock.js";
import { enforce, type Decision } from "../../shared-kernel/Decision.js";
import type { IdGenerator } from "../../shared-kernel/ids.js";
import type { AssessmentGateway, ContentHasher, CurriculumDirectory, LearnerDirectory } from "./ports.js";

export interface AssessmentDependencies {
  readonly gateway: AssessmentGateway;
  readonly curriculum: CurriculumDirectory;
  readonly learners: LearnerDirectory;
  readonly hasher: ContentHasher;
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export function auditOf(
  deps: Pick<AssessmentDependencies, "ids" | "clock">,
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
  deps: Pick<AssessmentDependencies, "gateway" | "ids" | "clock">,
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

/** JSON canonique (clés triées) : la même copie donne toujours la même empreinte (R6). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
