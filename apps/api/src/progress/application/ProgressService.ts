import type { Actor } from "../../identity/index.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { AuditAction } from "../../shared-kernel/auditActions.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import { enforce, type Decision } from "../../shared-kernel/Decision.js";
import { DomainError, NotFoundError } from "../../shared-kernel/DomainError.js";
import type { CompetencyId, IdGenerator, LearnerId } from "../../shared-kernel/ids.js";
import { BADGES, type Badge } from "../domain/badges.js";
import { levelForXp, xpForLevel } from "../domain/experience.js";
import { currentLevel, MASTERY_LEVELS, type Evidence, type MasteryLevel } from "../domain/mastery.js";
import { mondayOf, parisDate, streakOf, type StreakState } from "../domain/streak.js";
import { canManageProgress, canViewProgress } from "./policies.js";
import type {
  CatalogEntry,
  CurriculumCatalog,
  LearnerDirectory,
  ProgressGateway,
  ProgressStore,
} from "./ports.js";
import { ProgressProjector } from "./projector.js";

export class InvalidProgressInput extends DomainError {
  constructor(readonly code: `progress.invalid-${string}`) {
    super(`Saisie invalide (${code}).`);
  }
}

export interface ProgressDependencies {
  readonly gateway: ProgressGateway;
  readonly catalog: CurriculumCatalog;
  readonly learners: LearnerDirectory;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Progression d'UN élève : rien d'un autre élève, aucun classement ni comparaison (R17, R2). */
export interface LearnerProgress {
  readonly learnerId: string;
  readonly xp: number;
  readonly level: number;
  readonly currentLevelXp: number;
  readonly nextLevelXp: number;
  readonly streak: StreakState;
  readonly badges: ReadonlyArray<{ readonly badge: Badge; readonly awardedAt: string }>;
  readonly competencies: ReadonlyArray<{
    readonly competencyId: string;
    readonly code: string;
    readonly label: string;
    readonly subjectName: string;
    readonly level: MasteryLevel;
    readonly evidenceCount: number;
    readonly adjustment: { readonly justification: string; readonly adjustedAt: string } | null;
  }>;
  readonly subjects: ReadonlyArray<{
    readonly subjectId: string;
    readonly name: string;
    readonly average: number | null;
    readonly grades: ReadonlyArray<{
      readonly attemptId: string;
      readonly title: string;
      readonly grade: number;
      readonly publishedAt: string;
    }>;
  }>;
}

const ADJUSTABLE = ["not_acquired", "in_progress", "acquired", "exceeded"] as const;

/** Moyenne simple au demi-point le plus proche (big picture §8 : les notes sont au demi-point). */
function average(grades: readonly number[]): number | null {
  if (grades.length === 0) return null;
  return Math.round((grades.reduce((sum, grade) => sum + grade, 0) / grades.length) * 2) / 2;
}

/**
 * Lecture de la progression et ajustement des niveaux (L6). Les projections sont tenues à jour par le
 * `ProgressProjector`, alimenté par les événements des autres modules.
 */
export class ProgressService {
  constructor(private readonly deps: ProgressDependencies) {}

  /** Projecteur des événements d'un espace : le catalogue des compétences est celui de cet espace. */
  forSpace(tutorSpaceId: Actor["tutorSpaceId"]): ProgressProjector {
    return new ProgressProjector(() => this.deps.catalog.competencyCatalog(tutorSpaceId));
  }

  async learnerProgress(actor: Actor, learnerId: LearnerId): Promise<LearnerProgress> {
    const inSpace = (await this.deps.learners.existingLearners(actor.tutorSpaceId, [learnerId])).length === 1;
    await this.#authorize(actor, canViewProgress(actor, learnerId, inSpace), "progress.view", learnerId);
    const catalog = await this.deps.catalog.competencyCatalog(actor.tutorSpaceId);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      this.#progressOf(store, learnerId, catalog),
    );
  }

  /** Ajuster un niveau (big picture §6) : justification obligatoire, auditée ; prime jusqu'à la preuve suivante. */
  async adjust(
    actor: Actor,
    learnerId: LearnerId,
    competencyId: CompetencyId,
    rawLevel: unknown,
    rawJustification: unknown,
  ): Promise<void> {
    await this.#authorize(actor, canManageProgress(actor), "progress.adjust", learnerId);
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    if (typeof rawLevel !== "string" || !(ADJUSTABLE as readonly string[]).includes(rawLevel)) {
      throw new InvalidProgressInput("progress.invalid-level");
    }
    const level = rawLevel as (typeof ADJUSTABLE)[number];
    const justification =
      typeof rawJustification === "string" ? rawJustification.normalize("NFC").trim() : "";
    if (
      justification.length < 5 ||
      justification.length > 500 ||
      /\p{Cc}/u.test(justification.replace(/\n/g, ""))
    ) {
      throw new InvalidProgressInput("progress.invalid-justification");
    }
    if ((await this.deps.learners.existingLearners(actor.tutorSpaceId, [learnerId])).length !== 1)
      throw new NotFoundError();
    const catalog = await this.deps.catalog.competencyCatalog(actor.tutorSpaceId);
    if (!catalog.some((entry) => entry.id === competencyId)) throw new NotFoundError();
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      await store.insertAdjustment(learnerId, {
        id: this.deps.ids.next("AuditEntryId"),
        competencyId,
        level,
        justification,
        adjustedAt: now,
        adjustedBy: tutorId,
      });
      await this.forSpace(actor.tutorSpaceId).refresh(store, learnerId, now);
      await store.audit(this.#entry(actor, "progress.competency-adjusted", "success", learnerId));
    });
  }

  /** Synthèse du tuteur, par élève et par groupe. Réservée au tuteur : aucune vue agrégée pour un parent ou un élève (R17). */
  async overview(actor: Actor) {
    await this.#authorize(actor, canManageProgress(actor), "progress.overview");
    const catalog = await this.deps.catalog.competencyCatalog(actor.tutorSpaceId);
    const groups = await this.deps.catalog.groups(actor.tutorSpaceId);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const learnerIds = new Set<LearnerId>([
        ...(await store.learnersWithProgress()),
        ...groups.flatMap((group) => group.learnerIds),
      ]);
      const learners = [];
      for (const learnerId of [...learnerIds].sort()) {
        const progress = await this.#progressOf(store, learnerId, catalog);
        learners.push({
          learnerId,
          xp: progress.xp,
          level: progress.level,
          streak: progress.streak,
          levelCounts: countLevels(progress.competencies.map((competency) => competency.level)),
          averages: progress.subjects.map((subject) => ({
            subjectId: subject.subjectId,
            name: subject.name,
            average: subject.average,
          })),
        });
      }
      const byLearner = new Map(learners.map((entry) => [entry.learnerId as string, entry]));
      return {
        learners,
        groups: groups.map((group) => ({
          groupId: group.id,
          name: group.name,
          learnerIds: [...group.learnerIds],
          levelCounts: countLevels(
            group.learnerIds.flatMap((id) => {
              const entry = byLearner.get(id);
              return entry === undefined
                ? []
                : MASTERY_LEVELS.flatMap((level) =>
                    Array<MasteryLevel>(entry.levelCounts[level]).fill(level),
                  );
            }),
          ),
        })),
      };
    });
  }

  async #progressOf(
    store: ProgressStore,
    learnerId: LearnerId,
    catalog: readonly CatalogEntry[],
  ): Promise<LearnerProgress> {
    const xp = await store.xpOf(learnerId);
    const level = levelForXp(xp);
    const evidences = await store.evidencesOf(learnerId);
    const adjustments = await store.adjustmentsOf(learnerId);
    const byCompetency = new Map<string, Evidence[]>();
    for (const evidence of evidences)
      byCompetency.set(evidence.competencyId, [...(byCompetency.get(evidence.competencyId) ?? []), evidence]);
    const grades = await store.gradesOf(learnerId);
    const subjectNames = new Map(catalog.map((entry) => [entry.subjectId as string, entry.subjectName]));
    const subjects = [...new Set(grades.map((grade) => grade.subjectId as string))].map((subjectId) => {
      const own = grades
        .filter((grade) => grade.subjectId === subjectId)
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
      return {
        subjectId,
        name: subjectNames.get(subjectId) ?? "",
        average: average(own.map((grade) => grade.grade)),
        grades: own.map((grade) => ({
          attemptId: grade.attemptId,
          title: grade.title,
          grade: grade.grade,
          publishedAt: grade.publishedAt.toISOString(),
        })),
      };
    });
    const badges = (await store.badgesOf(learnerId)).sort(
      (a, b) => BADGES.indexOf(a.badge) - BADGES.indexOf(b.badge),
    );
    return {
      learnerId,
      xp,
      level,
      currentLevelXp: xpForLevel(level),
      nextLevelXp: xpForLevel(level + 1),
      streak: streakOf(await store.activityWeeksOf(learnerId), mondayOf(parisDate(this.deps.clock.now()))),
      badges: badges.map((entry) => ({ badge: entry.badge, awardedAt: entry.awardedAt.toISOString() })),
      // Compétences évaluées, ajustées, ou proposées au choix (non archivées).
      competencies: catalog
        .filter(
          (entry) =>
            !entry.archived ||
            byCompetency.has(entry.id) ||
            adjustments.some((adjustment) => adjustment.competencyId === entry.id),
        )
        .map((entry) => {
          const adjustment =
            adjustments.filter((candidate) => candidate.competencyId === entry.id).at(-1) ?? null;
          const list = byCompetency.get(entry.id) ?? [];
          const level = currentLevel(list, adjustment);
          const applies =
            adjustment !== null && !list.some((evidence) => evidence.recordedAt > adjustment.adjustedAt);
          return {
            competencyId: entry.id,
            code: entry.code,
            label: entry.label,
            subjectName: entry.subjectName,
            level,
            evidenceCount: list.length,
            adjustment: applies
              ? { justification: adjustment.justification, adjustedAt: adjustment.adjustedAt.toISOString() }
              : null,
          };
        }),
      subjects,
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

function countLevels(levels: readonly MasteryLevel[]): Record<MasteryLevel, number> {
  const counts: Record<MasteryLevel, number> = {
    not_assessed: 0,
    not_acquired: 0,
    in_progress: 0,
    acquired: 0,
    exceeded: 0,
  };
  for (const level of levels) counts[level]++;
  return counts;
}
