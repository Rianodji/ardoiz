import type { Actor } from "../../identity/index.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import { allow, assertNever, deny, enforce, hide, type Decision } from "../../shared-kernel/Decision.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { GuardianId, IdGenerator, SuggestionId, TutorSpaceId } from "../../shared-kernel/ids.js";
import {
  CATEGORIES,
  InvalidSuggestionInput,
  plainText,
  retryAfterSeconds,
  STATUSES,
  TooManySuggestionsError,
  type Category,
  type SuggestionStatus,
} from "../domain/suggestion.js";

export interface SuggestionRecord {
  readonly id: SuggestionId;
  readonly guardianId: GuardianId;
  readonly category: Category;
  readonly body: string;
  readonly createdAt: Date;
  readonly status: SuggestionStatus;
  readonly reply: string | null;
  readonly updatedAt: Date | null;
}

export interface SuggestionStore {
  insert(suggestion: SuggestionRecord): Promise<void>;
  byId(id: SuggestionId): Promise<SuggestionRecord | null>;
  all(): Promise<SuggestionRecord[]>;
  ofGuardian(guardianId: GuardianId): Promise<SuggestionRecord[]>;
  sentSince(guardianId: GuardianId, since: Date): Promise<Date[]>;
  update(id: SuggestionId, status: SuggestionStatus, reply: string | null, at: Date): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface SuggestionGateway {
  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: SuggestionStore) => Promise<T>): Promise<T>;
}

export interface FeedbackDependencies {
  readonly gateway: SuggestionGateway;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Envoyer une suggestion : le parent seul (matrice des droits). */
export function canSend(actor: Actor): Decision {
  switch (actor.kind) {
    case "guardian":
      return allow();
    case "tutor":
    case "learner":
      return deny("guardian-only");
    default:
      return assertNever(actor);
  }
}

/** Lire une suggestion : le tuteur ; le parent, les siennes ; un autre parent 👻 ; un élève 🚫. */
export function canRead(actor: Actor, suggestion: SuggestionRecord | null): Decision {
  if (actor.kind === "learner") return deny("not-for-learners");
  if (suggestion === null) return hide();
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
      return suggestion.guardianId === actor.id ? allow() : hide();
    default:
      return assertNever(actor);
  }
}

/** Traiter (statut, réponse) : le tuteur seul. */
export function canHandle(actor: Actor): Decision {
  switch (actor.kind) {
    case "tutor":
      return allow();
    case "guardian":
    case "learner":
      return deny("tutor-only");
    default:
      return assertNever(actor);
  }
}

/**
 * Suggestions des parents (big picture §7) : envoi en texte brut, débit limité (R15) ; le tuteur les
 * marque lues ou traitées et répond brièvement ; le parent voit le statut et la réponse.
 */
export class SuggestionService {
  constructor(private readonly deps: FeedbackDependencies) {}

  async send(actor: Actor, rawCategory: unknown, rawBody: unknown): Promise<SuggestionRecord> {
    await this.#authorize(actor, canSend(actor), "feedback.send");
    if (actor.kind !== "guardian") throw new NotFoundError();
    const guardianId = actor.id;
    const category = CATEGORIES.find((candidate) => candidate === rawCategory);
    if (category === undefined) throw new InvalidSuggestionInput("feedback.invalid-category");
    const body = plainText(rawBody, 2000, "feedback.invalid-body");
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const wait = retryAfterSeconds(
        await store.sentSince(guardianId, new Date(now.getTime() - 24 * 3_600_000)),
        now,
      );
      if (wait !== null) throw new TooManySuggestionsError(wait);
      const suggestion: SuggestionRecord = {
        id: this.deps.ids.next("SuggestionId"),
        guardianId,
        category,
        body,
        createdAt: now,
        status: "new",
        reply: null,
        updatedAt: null,
      };
      await store.insert(suggestion);
      await store.audit(this.#entry(actor, "feedback.sent", "success", suggestion.id));
      return suggestion;
    });
  }

  /** Le tuteur voit toutes les suggestions ; un parent, les siennes ; un élève, rien (🚫). */
  async list(actor: Actor): Promise<SuggestionRecord[]> {
    if (actor.kind === "learner") await this.#authorize(actor, deny("not-for-learners"), "feedback.list");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      actor.kind === "guardian" ? store.ofGuardian(actor.id) : store.all(),
    );
  }

  async get(actor: Actor, id: SuggestionId): Promise<SuggestionRecord> {
    const suggestion = await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.byId(id));
    await this.#authorize(actor, canRead(actor, suggestion), "feedback.read", id);
    if (suggestion === null) throw new NotFoundError();
    return suggestion;
  }

  async handle(actor: Actor, id: SuggestionId, rawStatus: unknown, rawReply: unknown): Promise<void> {
    await this.#authorize(actor, canHandle(actor), "feedback.handle", id);
    const status = STATUSES.find((candidate) => candidate === rawStatus && candidate !== "new");
    if (status === undefined) throw new InvalidSuggestionInput("feedback.invalid-status");
    const reply =
      rawReply === undefined || rawReply === null || rawReply === ""
        ? null
        : plainText(rawReply, 500, "feedback.invalid-reply");
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const suggestion = await store.byId(id);
      if (suggestion === null) throw new NotFoundError();
      await store.update(id, status, reply ?? suggestion.reply, this.deps.clock.now());
      await store.audit(this.#entry(actor, "feedback.handled", "success", id));
    });
  }

  #entry(
    actor: Actor,
    action: string,
    outcome: AuditEntry["outcome"],
    targetId?: string,
    reasonCode?: string,
  ): AuditEntry {
    return {
      id: this.deps.ids.next("AuditEntryId"),
      tutorSpaceId: actor.tutorSpaceId,
      action,
      actor: { kind: actor.kind, id: actor.id },
      outcome,
      occurredAt: this.deps.clock.now(),
      ...(targetId === undefined ? {} : { targetId }),
      ...(reasonCode === undefined ? {} : { reasonCode }),
    };
  }

  async #authorize(actor: Actor, decision: Decision, action: string, targetId?: string): Promise<void> {
    if (decision.kind !== "allow") {
      const entry = this.#entry(
        actor,
        action,
        "denied",
        targetId,
        decision.kind === "hide" ? "hidden" : decision.reason,
      );
      await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.audit(entry));
    }
    enforce(decision);
  }
}
