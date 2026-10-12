import type { AuditActor, AuditEntry, AuditOutcome } from "../../shared-kernel/AuditTrail.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import { enforce, type Decision } from "../../shared-kernel/Decision.js";
import type { IdGenerator, TutorSpaceId } from "../../shared-kernel/ids.js";
import type { Actor } from "./Actor.js";
import { ReauthenticationRequiredError } from "./errors.js";
import type {
  ConsentTexts,
  IdentityGateway,
  LinkBuilder,
  LoginThrottle,
  BackgroundTasks,
  Mailer,
  PasswordHasher,
  RequestQuota,
  SecretTokens,
  TotpService,
} from "./ports.js";
import { STEP_UP_WINDOW_MS } from "./sessionRules.js";

export interface IdentityDependencies {
  readonly gateway: IdentityGateway;
  readonly hasher: PasswordHasher;
  readonly tokens: SecretTokens;
  readonly totp: TotpService;
  readonly mailer: Mailer;
  readonly throttle: LoginThrottle;
  readonly consentTexts: ConsentTexts;
  readonly links: LinkBuilder;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly commonPasswords: ReadonlySet<string>;
  readonly background: BackgroundTasks;
  readonly quota: RequestQuota;
}

export function auditActorOf(actor: Actor): AuditActor {
  return { kind: actor.kind, id: actor.id };
}

export function auditEntry(
  deps: Pick<IdentityDependencies, "ids" | "clock">,
  tutorSpaceId: TutorSpaceId,
  actor: AuditActor,
  action: string,
  outcome: AuditOutcome,
  details: { targetId?: string; reasonCode?: string } = {},
): AuditEntry {
  return {
    id: deps.ids.next("AuditEntryId"),
    tutorSpaceId,
    action,
    actor,
    outcome,
    occurredAt: deps.clock.now(),
    ...(details.targetId === undefined ? {} : { targetId: details.targetId }),
    ...(details.reasonCode === undefined ? {} : { reasonCode: details.reasonCode }),
  };
}

/**
 * Applique une décision de politique. Un refus est journalisé (R12) dans sa propre transaction,
 * puis levé : 403 pour `deny`, 404 pour `hide` (R2, R18).
 */
export async function authorize(
  deps: Pick<IdentityDependencies, "gateway" | "ids" | "clock">,
  actor: Actor,
  decision: Decision,
  action: string,
  targetId?: string,
): Promise<void> {
  if (decision.kind !== "allow") {
    const entry = auditEntry(deps, actor.tutorSpaceId, auditActorOf(actor), action, "denied", {
      reasonCode: decision.kind === "hide" ? "hidden" : decision.reason,
      ...(targetId === undefined ? {} : { targetId }),
    });
    await deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.audit(entry));
  }
  enforce(decision);
}

/** Action sensible : la dernière preuve d'identité doit dater de moins de 10 minutes (R7). */
export function requireRecentAuthentication(actor: Actor, now: Date): void {
  if (now.getTime() - actor.authenticatedAt.getTime() > STEP_UP_WINDOW_MS)
    throw new ReauthenticationRequiredError();
}
