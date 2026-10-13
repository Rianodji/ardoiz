import type { CompetencyId, LearnerId, SubjectId } from "../../shared-kernel/ids.js";
import { earnedBadges } from "../domain/badges.js";
import { questionSucceeded, XP_VALUES } from "../domain/experience.js";
import {
  currentLevel,
  isAcquired,
  levelHistory,
  type Evidence,
  type MasteryLevel,
} from "../domain/mastery.js";
import { mondayOf, parisDate, streakOf } from "../domain/streak.js";
import type { CatalogEntry, ProgressStore } from "./ports.js";

/** Événements lus (strictement) par l'infrastructure, puis appliqués ici. */
export interface CorrectionPublished {
  readonly attemptId: string;
  readonly subjectId: SubjectId;
  readonly title: string;
  readonly learnerId: LearnerId;
  readonly grade: number;
  readonly publishedAt: Date;
  readonly questions: ReadonlyArray<{
    readonly questionId: string;
    readonly conversion: boolean;
    readonly earned: number;
    readonly points: number;
    readonly competencyIds: readonly CompetencyId[];
  }>;
}

export interface GradeRectified {
  readonly attemptId: string;
  readonly learnerId: LearnerId;
  readonly questionId: string;
  readonly earned: number;
  readonly points: number;
  readonly grade: number;
  readonly rectifiedAt: Date;
}

export interface AttemptSubmitted {
  readonly attemptId: string;
  readonly assignmentId: string;
  readonly learnerId: LearnerId;
  readonly submittedAt: Date;
  readonly late: boolean;
}

export interface LessonCompleted {
  readonly learnerId: LearnerId;
  readonly lessonId: string;
  readonly completedAt: Date;
}

export interface SessionJoined {
  readonly learnerId: LearnerId;
  readonly occurrenceId: string;
  readonly joinedAt: Date;
}

const week = (instant: Date) => mondayOf(parisDate(instant));

/**
 * Applique les événements aux projections de progression (L6). Chaque effet est idempotent par
 * construction (clés uniques), en plus de l'inbox : rejouer un événement ne double rien. Après chaque
 * événement, les récompenses sont recalculées et seules celles qui MANQUENT sont ajoutées (jamais de
 * retrait, R17). L'instant utilisé est celui de l'événement : une reconstruction donne le même résultat.
 */
export class ProgressProjector {
  constructor(private readonly catalog: (store: ProgressStore) => Promise<readonly CatalogEntry[]>) {}

  async correctionPublished(store: ProgressStore, event: CorrectionPublished): Promise<void> {
    const { learnerId, publishedAt } = event;
    await store.upsertGrade(learnerId, {
      attemptId: event.attemptId,
      subjectId: event.subjectId,
      title: event.title,
      grade: event.grade,
      publishedAt,
    });
    for (const question of event.questions) {
      for (const competencyId of question.competencyIds) {
        await store.insertEvidence(learnerId, {
          competencyId,
          attemptId: event.attemptId,
          copyId: event.attemptId,
          questionId: question.questionId,
          earned: question.earned,
          points: question.points,
          recordedAt: publishedAt,
        });
      }
      const succeeded = questionSucceeded(question.earned, question.points);
      if (succeeded) {
        await store.addXp(
          learnerId,
          "question-succeeded",
          `${event.attemptId}:${question.questionId}`,
          XP_VALUES["question-succeeded"],
          publishedAt,
        );
      }
      if (question.conversion)
        await store.recordConversion(learnerId, event.attemptId, question.questionId, succeeded, publishedAt);
    }
    await this.refresh(store, learnerId, publishedAt);
  }

  /**
   * Une rectification met à jour la preuve et la note ; elle peut rapporter des points, jamais en retirer (R17).
   * QUESTION Q22 : une note rectifiée à la baisse laisse les points déjà gagnés (et un badge obtenu).
   */
  async gradeRectified(store: ProgressStore, event: GradeRectified): Promise<void> {
    await store.updateEvidenceEarned(event.attemptId, event.questionId, event.earned, event.points);
    await store.updateGrade(event.attemptId, event.grade);
    const succeeded = questionSucceeded(event.earned, event.points);
    await store.updateConversion(event.attemptId, event.questionId, succeeded);
    if (succeeded) {
      await store.addXp(
        event.learnerId,
        "question-succeeded",
        `${event.attemptId}:${event.questionId}`,
        XP_VALUES["question-succeeded"],
        event.rectifiedAt,
      );
    }
    await this.refresh(store, event.learnerId, event.rectifiedAt);
  }

  async attemptSubmitted(store: ProgressStore, event: AttemptSubmitted): Promise<void> {
    await store.recordSubmission(event.learnerId, event.attemptId, event.submittedAt, event.late);
    await store.addActivityWeek(event.learnerId, week(event.submittedAt));
    // Une fois par ATTRIBUTION, même avec plusieurs tentatives : une copie vide de plus ne rapporte
    // rien (big picture §8, verdict L6 S-3).
    if (!event.late) {
      await store.addXp(
        event.learnerId,
        "submitted-on-time",
        event.assignmentId,
        XP_VALUES["submitted-on-time"],
        event.submittedAt,
      );
    }
    await this.refresh(store, event.learnerId, event.submittedAt);
  }

  async lessonCompleted(store: ProgressStore, event: LessonCompleted): Promise<void> {
    await store.addActivityWeek(event.learnerId, week(event.completedAt));
    await store.addXp(
      event.learnerId,
      "lesson-completed",
      event.lessonId,
      XP_VALUES["lesson-completed"],
      event.completedAt,
    );
    await this.refresh(store, event.learnerId, event.completedAt);
  }

  /** Présence (verdict L5) : l'élève a lui-même cliqué « Rejoindre » ; 15 points, une fois par occurrence. */
  async sessionJoined(store: ProgressStore, event: SessionJoined): Promise<void> {
    await store.addActivityWeek(event.learnerId, week(event.joinedAt));
    await store.addXp(
      event.learnerId,
      "session-attended",
      event.occurrenceId,
      XP_VALUES["session-attended"],
      event.joinedAt,
    );
    await this.refresh(store, event.learnerId, event.joinedAt);
  }

  /** Ajoute les points « compétence acquise » et les badges qui manquent. */
  async refresh(store: ProgressStore, learnerId: LearnerId, at: Date): Promise<void> {
    const evidences = await store.evidencesOf(learnerId);
    const byCompetency = new Map<string, Evidence[]>();
    for (const evidence of evidences)
      byCompetency.set(evidence.competencyId, [...(byCompetency.get(evidence.competencyId) ?? []), evidence]);
    // « Compétence passée à Acquis » : une fois par compétence, sur le niveau CALCULÉ (les ajustements n'en donnent pas).
    for (const [competencyId, list] of byCompetency) {
      if (levelHistory(list).some(isAcquired)) {
        await store.addXp(
          learnerId,
          "competency-acquired",
          competencyId,
          XP_VALUES["competency-acquired"],
          at,
        );
      }
    }
    const catalog = await this.catalog(store);
    const adjustments = await store.adjustmentsOf(learnerId);
    const levelsByCode = new Map<string, MasteryLevel>();
    for (const entry of catalog) {
      const adjustment =
        adjustments.filter((candidate) => candidate.competencyId === entry.id).at(-1) ?? null;
      levelsByCode.set(entry.code, currentLevel(byCompetency.get(entry.id) ?? [], adjustment));
    }
    const badges = earnedBadges({
      submittedCopies: await store.submissionCount(learnerId),
      levelsByCode,
      conversions: await store.conversionsOf(learnerId),
      bestStreak: streakOf(await store.activityWeeksOf(learnerId), week(at)).best,
      evidencesByCompetency: byCompetency,
    });
    for (const badge of badges) await store.addBadge(learnerId, badge, at);
  }
}
