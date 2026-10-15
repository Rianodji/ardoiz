import type { Actor } from "../../identity/index.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { AuditAction } from "../../shared-kernel/auditActions.js";
import type { Clock, RandomSource } from "../../shared-kernel/Clock.js";
import { enforce, type Decision } from "../../shared-kernel/Decision.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type {
  GroupId,
  IdGenerator,
  LearnerId,
  SessionOccurrenceId,
  TutoringSessionId,
} from "../../shared-kernel/ids.js";
import { InvalidSchedulingInput, SchedulingConflictError } from "../domain/errors.js";
import { addDays, localToUtc, parseLocalDate, parseLocalTime, utcToLocal } from "../domain/localTime.js";
import { MeetingLink } from "../domain/meetingLink.js";
import {
  assertInFuture,
  LINK_LEAD_MS,
  linkWindowOpen,
  occurrenceAt,
  occurrencesOf,
  parseDuration,
  parseRecurrence,
} from "../domain/schedule.js";
import { canObtainLink, canPlan, canSeeSession } from "./policies.js";
import type {
  GroupDirectory,
  LearnerDirectory,
  OccurrenceRecord,
  SchedulingGateway,
  SchedulingStore,
  SessionRecord,
} from "./ports.js";

/** Événement d'intégration : un élève a rejoint une séance (glossaire : SéanceRejointe), pour le L6. */
export const SESSION_JOINED = "scheduling.session-joined";

export interface SchedulingDependencies {
  readonly gateway: SchedulingGateway;
  readonly learners: LearnerDirectory;
  readonly groups: GroupDirectory;
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Hôte Jitsi supplémentaire de la configuration (Q5), ou null. */
  readonly extraMeetingHost: string | null;
}

export interface PlanInput {
  readonly title: unknown;
  readonly audience:
    { readonly kind: "learner"; readonly id: LearnerId } | { readonly kind: "group"; readonly id: GroupId };
  readonly schedule: {
    readonly kind: "once" | "weekly";
    readonly date: unknown;
    readonly time: unknown;
    readonly durationMinutes: unknown;
    readonly until?: unknown;
  };
  /** Absent : Ardoiz génère une salle Jitsi au nom imprévisible. */
  readonly link?: unknown;
}

/** Une séance telle qu'un acteur la voit. Le lien n'y figure que s'il lui est révélé (R9). */
export interface OccurrenceView {
  readonly occurrenceId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** Date et heures en heure de Paris (H8). */
  readonly local: { readonly date: string; readonly start: string; readonly end: string };
  readonly status: "scheduled" | "cancelled";
  readonly moved: boolean;
  /** Participants visibles par l'acteur : tous pour le tuteur, ses enfants pour le parent, aucun pour l'élève. */
  readonly participantIds: readonly string[];
  readonly linkAvailableFrom: string;
  readonly meetingLink: string | null;
}

const MAX_TITLE = 120;
const MAX_AGENDA_DAYS = 62;

function plainTitle(raw: unknown): string {
  if (typeof raw !== "string") throw new InvalidSchedulingInput("scheduling.invalid-title");
  const title = raw.normalize("NFC").trim();
  if (title.length === 0 || title.length > MAX_TITLE || /\p{Cc}/u.test(title)) {
    throw new InvalidSchedulingInput("scheduling.invalid-title");
  }
  return title;
}

/**
 * Planification (L5) : séances ponctuelles ou hebdomadaires en heure de Paris (H8), participants, lien
 * de visio sur liste blanche, révélé aux seuls participants de T−15 min à la fin (R9). Le tuteur
 * planifie, déplace, annule et change le lien ; un élève rejoint, ce qui compte sa présence.
 */
export class SchedulingService {
  constructor(private readonly deps: SchedulingDependencies) {}

  async plan(actor: Actor, input: PlanInput): Promise<SessionRecord> {
    await this.#authorize(actor, canPlan(actor), "scheduling.plan");
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    const title = plainTitle(input.title);
    const recurrence = parseRecurrence(input.schedule);
    const link = this.#link(input.link);
    const now = this.deps.clock.now();
    const planned = occurrencesOf(recurrence);
    const first = planned[0];
    if (first === undefined) throw new InvalidSchedulingInput("scheduling.invalid-date");
    assertInFuture(first, now);
    const learnerIds = await this.#audience(actor, input.audience);
    const session: SessionRecord = {
      id: this.deps.ids.next("TutoringSessionId"),
      title,
      meetingLink: link.href,
      recurrence,
      learnerIds,
      createdAt: now,
      createdBy: tutorId,
      linkChangedAt: now,
    };
    const occurrences: OccurrenceRecord[] = planned.map((occurrence) => ({
      id: this.deps.ids.next("SessionOccurrenceId"),
      sessionId: session.id,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      moved: false,
      cancelledAt: null,
    }));
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      await store.insertSession(session, occurrences);
      await store.audit(this.#entry(actor, "scheduling.planned", "success", session.id));
    });
    return session;
  }

  /** Séances du tuteur, avec leur lien et leurs occurrences à venir. */
  async sessions(actor: Actor) {
    await this.#authorize(actor, canPlan(actor), "scheduling.list");
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const sessions = await store.sessions();
      const result = [];
      for (const session of sessions) {
        const occurrences = (await store.occurrencesOf(session.id)).filter(
          (occurrence) => occurrence.endsAt > now,
        );
        result.push({
          session,
          occurrences: occurrences.map((occurrence) => this.#view(actor, session, occurrence, true)),
        });
      }
      return result;
    });
  }

  /** Agenda de l'acteur, du jour local `from` sur `days` jours (au plus 62), SANS aucun lien (R9). */
  async agenda(actor: Actor, rawFrom: unknown, rawDays: unknown): Promise<OccurrenceView[]> {
    const from = parseLocalDate(rawFrom);
    if (
      typeof rawDays !== "number" ||
      !Number.isInteger(rawDays) ||
      rawDays < 1 ||
      rawDays > MAX_AGENDA_DAYS
    ) {
      throw new InvalidSchedulingInput("scheduling.invalid-days");
    }
    const start = localToUtc({ date: from, time: "00:00" });
    const end = localToUtc({ date: addDays(from, rawDays), time: "00:00" });
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const sessions = new Map((await store.sessions()).map((session) => [session.id as string, session]));
      const occurrences = await store.occurrencesBetween(start, end);
      return occurrences.flatMap((occurrence) => {
        const session = sessions.get(occurrence.sessionId);
        if (session === undefined) return [];
        // Même règle que pour une séance seule : on ne liste que ce que l'acteur a le droit de voir.
        return canSeeSession(actor, new Set(session.learnerIds)).kind === "allow"
          ? [this.#view(actor, session, occurrence, false)]
          : [];
      });
    });
  }

  /** Une séance : le lien n'y figure que pour le tuteur, ou l'élève participant dans la fenêtre (R9). */
  async occurrence(actor: Actor, id: SessionOccurrenceId): Promise<OccurrenceView> {
    const found = await this.#load(actor, id);
    await this.#authorize(
      actor,
      canSeeSession(actor, found === null ? null : new Set(found.session.learnerIds)),
      "scheduling.view",
      id,
    );
    if (found === null) throw new NotFoundError();
    const reveal =
      actor.kind === "tutor" ||
      (actor.kind === "learner" &&
        linkWindowOpen(
          { ...found.occurrence, cancelled: found.occurrence.cancelledAt !== null },
          this.deps.clock.now(),
        ));
    return this.#view(actor, found.session, found.occurrence, reveal);
  }

  /**
   * Rejoindre (R9) : l'élève participant obtient le lien dans la fenêtre, et sa présence est notée une
   * fois (événement `SéanceRejointe` dans l'outbox, même transaction). Afficher la séance ne vaut PAS
   * présence : seul ce geste explicite compte. Le tuteur obtient le lien sans présence notée.
   */
  async join(actor: Actor, id: SessionOccurrenceId): Promise<{ meetingLink: string }> {
    const found = await this.#load(actor, id);
    await this.#authorize(
      actor,
      canObtainLink(actor, found === null ? null : new Set(found.session.learnerIds)),
      "scheduling.join",
      id,
    );
    if (found === null) throw new NotFoundError();
    const { session, occurrence } = found;
    const link = this.servedLink(session);
    if (link === null) throw new SchedulingConflictError("scheduling.link-to-replace");
    if (actor.kind !== "learner") return { meetingLink: link };
    const learnerId = actor.id;
    const now = this.deps.clock.now();
    if (!linkWindowOpen({ ...occurrence, cancelled: occurrence.cancelledAt !== null }, now)) {
      throw new SchedulingConflictError(
        occurrence.cancelledAt === null ? "scheduling.link-not-available" : "scheduling.cancelled",
      );
    }
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if (!(await store.recordAttendance(occurrence.id, learnerId, now))) return;
      await store.publish({
        id: this.deps.ids.next("EventId"),
        type: SESSION_JOINED,
        tutorSpaceId: actor.tutorSpaceId,
        occurredAt: now,
        payload: {
          learnerId,
          sessionId: session.id,
          occurrenceId: occurrence.id,
          joinedAt: now.toISOString(),
        },
      });
    });
    return { meetingLink: link };
  }

  /**
   * Lien relu en base, REVALIDÉ avant d'être servi (verdict L5, S-1) : avec la liste d'hôtes et le
   * `MEETING_EXTRA_HOST` courants. Un lien altéré en base, ou devenu invalide, n'est servi à personne
   * (null) ; le tuteur voit qu'il est à remplacer.
   */
  servedLink(session: SessionRecord): string | null {
    try {
      return MeetingLink.parse(session.meetingLink, this.deps.extraMeetingHost).href;
    } catch {
      return null;
    }
  }

  /** Déplacer une occurrence à venir (date, heure et durée en heure de Paris). */
  async move(
    actor: Actor,
    id: SessionOccurrenceId,
    raw: { date: unknown; time: unknown; durationMinutes: unknown },
  ): Promise<void> {
    await this.#authorize(actor, canPlan(actor), "scheduling.move", id);
    const target = occurrenceAt(
      parseLocalDate(raw.date),
      parseLocalTime(raw.time),
      parseDuration(raw.durationMinutes),
    );
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const occurrence = await this.#mutable(store, id, now);
      assertInFuture(target, now);
      await store.moveOccurrence(occurrence.id, target.startsAt, target.endsAt);
      await store.audit(this.#entry(actor, "scheduling.moved", "success", id));
    });
  }

  /** Annuler une occurrence, ou toutes les occurrences à venir de sa séance. */
  async cancel(actor: Actor, id: SessionOccurrenceId, wholeSeries: boolean): Promise<void> {
    await this.#authorize(actor, canPlan(actor), "scheduling.cancel", id);
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const occurrence = await this.#mutable(store, id, now);
      const targets = wholeSeries
        ? (await store.occurrencesOf(occurrence.sessionId)).filter(
            (candidate) =>
              candidate.cancelledAt === null &&
              candidate.endsAt > now &&
              candidate.startsAt >= occurrence.startsAt,
          )
        : [occurrence];
      for (const target of targets) await store.cancelOccurrence(target.id, now);
      await store.audit(
        this.#entry(
          actor,
          wholeSeries ? "scheduling.series-cancelled" : "scheduling.cancelled",
          "success",
          id,
        ),
      );
    });
  }

  /**
   * Changer le lien d'une séance (M10) : un nouveau lien fourni, ou une nouvelle salle Jitsi générée —
   * par exemple après une fuite. L'ancien lien n'est plus servi à personne.
   */
  async changeLink(actor: Actor, id: TutoringSessionId, rawLink: unknown): Promise<void> {
    await this.#authorize(actor, canPlan(actor), "scheduling.change-link", id);
    const link = this.#link(rawLink);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if ((await store.sessionById(id)) === null) throw new NotFoundError();
      await store.changeLink(id, link.href, this.deps.clock.now());
      await store.audit(this.#entry(actor, "scheduling.link-changed", "success", id));
    });
  }

  #link(raw: unknown): MeetingLink {
    return raw === undefined || raw === null || raw === ""
      ? MeetingLink.generatedJitsi(this.deps.random.token() + this.deps.random.token())
      : MeetingLink.parse(raw, this.deps.extraMeetingHost);
  }

  async #audience(actor: Actor, audience: PlanInput["audience"]): Promise<LearnerId[]> {
    const learnerIds =
      audience.kind === "learner"
        ? [audience.id]
        : await this.deps.groups.learnersOfGroup(actor.tutorSpaceId, audience.id);
    if (learnerIds === null) throw new NotFoundError();
    if (learnerIds.length === 0) throw new InvalidSchedulingInput("scheduling.invalid-audience");
    // Un identifiant qui n'est pas un élève de l'espace : 404 (R2).
    const existing = await this.deps.learners.existingLearners(actor.tutorSpaceId, learnerIds);
    if (existing.length !== new Set(learnerIds).size) throw new NotFoundError();
    return [...new Set(learnerIds)];
  }

  async #load(
    actor: Actor,
    id: SessionOccurrenceId,
  ): Promise<{ session: SessionRecord; occurrence: OccurrenceRecord } | null> {
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const occurrence = await store.occurrenceById(id);
      const session = occurrence === null ? null : await store.sessionById(occurrence.sessionId);
      return occurrence === null || session === null ? null : { session, occurrence };
    });
  }

  async #mutable(store: SchedulingStore, id: SessionOccurrenceId, now: Date): Promise<OccurrenceRecord> {
    const occurrence = await store.occurrenceById(id);
    if (occurrence === null) throw new NotFoundError();
    if (occurrence.cancelledAt !== null) throw new SchedulingConflictError("scheduling.cancelled");
    if (occurrence.endsAt <= now) throw new SchedulingConflictError("scheduling.already-ended");
    return occurrence;
  }

  #view(actor: Actor, session: SessionRecord, occurrence: OccurrenceRecord, reveal: boolean): OccurrenceView {
    const start = utcToLocal(occurrence.startsAt);
    const end = utcToLocal(occurrence.endsAt);
    const visibleParticipants =
      actor.kind === "tutor"
        ? session.learnerIds
        : actor.kind === "guardian"
          ? session.learnerIds.filter((id) => actor.learnerIds.has(id))
          : [];
    return {
      occurrenceId: occurrence.id,
      sessionId: session.id,
      title: session.title,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      local: { date: start.date, start: start.time, end: end.time },
      status: occurrence.cancelledAt === null ? "scheduled" : "cancelled",
      moved: occurrence.moved,
      participantIds: [...visibleParticipants],
      linkAvailableFrom: new Date(occurrence.startsAt.getTime() - LINK_LEAD_MS).toISOString(),
      meetingLink: reveal && occurrence.cancelledAt === null ? this.servedLink(session) : null,
    };
  }

  #entry(
    actor: Actor,
    action: AuditAction,
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

  /** Un refus est journalisé dans sa propre transaction (R12), puis levé (R2, R18). */
  async #authorize(actor: Actor, decision: Decision, action: AuditAction, targetId?: string): Promise<void> {
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
