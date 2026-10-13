import type { PoolClient } from "pg";
import { ATTEMPT_SUBMITTED, CORRECTION_PUBLISHED, GRADE_RECTIFIED } from "../../assessment/index.js";
import { LESSON_COMPLETED } from "../../curriculum/index.js";
import type { EventSubscriber } from "../../platform/messaging/OutboxRelay.js";
import { prefixedId, readPayload, type EventReader } from "../../platform/messaging/readEvent.js";
import { SESSION_JOINED } from "../../scheduling/index.js";
import type { LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";
import {
  CompetencyId as competencyId,
  LearnerId as learnerId,
  SubjectId as subjectId,
} from "../../shared-kernel/ids.js";
import type { ProgressService } from "../application/ProgressService.js";
import type { ProgressProjector } from "../application/projector.js";
import { PgProgressStore } from "./PgProgressStore.js";

/**
 * Lecture STRICTE des événements consommés par la progression (verdict L5 §6) : un champ manquant,
 * mal formé ou inconnu rend l'événement illisible ; il part en file d'échec, sans effet et sans faire
 * planter le relais.
 */
const learner = (reader: EventReader, key = "learnerId"): LearnerId =>
  learnerId(reader.string(key, prefixedId("lrn")));
type Apply = (
  projector: ProgressProjector,
  store: PgProgressStore,
  payload: Readonly<Record<string, unknown>>,
) => Promise<void>;

export const PROGRESS_EVENTS: Readonly<Record<string, Apply>> = {
  [CORRECTION_PUBLISHED]: (projector, store, payload) =>
    projector.correctionPublished(
      store,
      readPayload(payload, (r) => {
        const event = {
          attemptId: r.string("attemptId", prefixedId("att")),
          subjectId: subjectId(r.string("subjectId", prefixedId("sbj"))),
          title: r.string("title", /^[\s\S]{1,120}$/),
          learnerId: learner(r),
          grade: r.number("grade", 0, 20),
          publishedAt: r.date("publishedAt"),
          questions: r.list("questions", 50, (q) => ({
            questionId: q.string("questionId", prefixedId("qst")),
            kind: q.oneOf("kind", ["mcq", "numeric", "short_text", "notebook"] as const),
            conversion: q.boolean("conversion"),
            earned: q.halfPoints("earned", 100),
            points: q.halfPoints("points", 100),
            competencyIds: q.strings("competencyIds", 10, prefixedId("cmp")).map((id) => competencyId(id)),
          })),
        };
        // Champs connus mais inutiles à la progression : lus pour que la lecture reste stricte.
        r.string("assignmentId", prefixedId("asg"));
        r.string("assessmentId", prefixedId("asm"));
        return event;
      }),
    ),
  [GRADE_RECTIFIED]: (projector, store, payload) =>
    projector.gradeRectified(
      store,
      readPayload(payload, (r) => ({
        attemptId: r.string("attemptId", prefixedId("att")),
        learnerId: learner(r),
        questionId: r.string("questionId", prefixedId("qst")),
        earned: r.halfPoints("earned", 100),
        points: r.halfPoints("points", 100),
        grade: r.number("grade", 0, 20),
        rectifiedAt: r.date("rectifiedAt"),
      })),
    ),
  [ATTEMPT_SUBMITTED]: (projector, store, payload) =>
    projector.attemptSubmitted(
      store,
      readPayload(payload, (r) => {
        const event = {
          attemptId: r.string("attemptId", prefixedId("att")),
          learnerId: learner(r),
          submittedAt: r.date("submittedAt"),
          late: r.boolean("late"),
        };
        r.string("assignmentId", prefixedId("asg"));
        return event;
      }),
    ),
  [LESSON_COMPLETED]: (projector, store, payload) =>
    projector.lessonCompleted(
      store,
      readPayload(payload, (r) => {
        const event = {
          learnerId: learner(r),
          lessonId: r.string("lessonId", prefixedId("les")),
          completedAt: r.date("completedAt"),
        };
        r.nullableString("subjectId", prefixedId("sbj"));
        return event;
      }),
    ),
  [SESSION_JOINED]: (projector, store, payload) =>
    projector.sessionJoined(
      store,
      readPayload(payload, (r) => {
        const event = {
          learnerId: learner(r),
          occurrenceId: r.string("occurrenceId", prefixedId("soc")),
          joinedAt: r.date("joinedAt"),
        };
        r.string("sessionId", prefixedId("tss"));
        return event;
      }),
    ),
};

/** Consommateurs du module : un par type d'événement, tous sous le nom « progress ». */
export function progressSubscribers(service: ProgressService): EventSubscriber[] {
  return Object.entries(PROGRESS_EVENTS).map(([eventType, apply]) => ({
    consumer: "progress",
    eventType,
    handle: (event, client: PoolClient) =>
      apply(
        service.forSpace(event.tutorSpaceId),
        new PgProgressStore(client, event.tutorSpaceId),
        event.payload,
      ),
  }));
}

/**
 * Reconstruction des projections d'un espace depuis l'outbox (commande « rebuild-progress ») : tout est
 * vidé puis rejoué dans l'ordre, dans UNE transaction. Les ajustements du tuteur, données sources, restent.
 * Un événement illisible est compté et ignoré.
 */
export async function rebuildProgress(
  client: PoolClient,
  service: ProgressService,
  tutorSpaceId: TutorSpaceId,
): Promise<{ applied: number; skipped: number }> {
  const store = new PgProgressStore(client, tutorSpaceId);
  await store.clearProjections();
  const { rows } = await client.query<{ type: string; payload: Record<string, unknown> }>(
    `SELECT type, payload FROM messaging.outbox WHERE type = ANY($1::text[]) ORDER BY id`,
    [Object.keys(PROGRESS_EVENTS)],
  );
  const projector = service.forSpace(tutorSpaceId);
  let applied = 0;
  let skipped = 0;
  for (const row of rows) {
    const apply = PROGRESS_EVENTS[row.type];
    if (apply === undefined) continue;
    await client.query("SAVEPOINT replay");
    try {
      await apply(projector, store, row.payload);
      await client.query("RELEASE SAVEPOINT replay");
      applied++;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT replay");
      skipped++;
    }
  }
  return { applied, skipped };
}
