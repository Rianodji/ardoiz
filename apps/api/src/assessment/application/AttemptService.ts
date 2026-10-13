import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { AssignmentId, AttemptId, LearnerId, NotebookMediaId } from "../../shared-kernel/ids.js";
import { AttemptRefusedError, InvalidAssessmentInput, TooManyUploadsError } from "../domain/errors.js";
import { autoGrade, gradeOutOf20, type Answer } from "../domain/grading.js";
import type { Question } from "../domain/questions.js";
import { answersRevealed, assertCanStart, assertCanWork, assertDraftSaveAllowed } from "../domain/window.js";
import { canViewAttempt, canWorkOnAssignment } from "./policies.js";
import { MAX_NOTEBOOK_IMAGES, storedScene } from "./notebook.js";
import type {
  AssessmentRecord,
  AssessmentStore,
  AssignmentRecord,
  AttemptRecord,
  ContentHasher,
  OptionAlias,
  StoredScene,
} from "./ports.js";
import { attemptForLearner, type LearnerAnswerView, type LearnerAttemptView } from "./projections.js";
import { ATTEMPT_SUBMITTED, publishAttempt } from "./publication.js";
import { auditOf, authorize, canonicalJson, type AssessmentDependencies } from "./support.js";

export interface AssignmentSummary {
  readonly assignmentId: string;
  readonly title: string;
  readonly opensAt: string;
  readonly dueAt: string;
  readonly lateAllowed: boolean;
  readonly attemptsLeft: number;
  readonly state: "upcoming" | "open" | "in_progress" | "submitted" | "published" | "closed";
  readonly currentAttemptId: string | null;
  readonly grade: number | null;
}

const MAX_TEXT_ANSWER = 2_000;

/**
 * Passage d'une épreuve par l'élève (R5, R6) : commencer, enregistrer un brouillon, rendre.
 * La fenêtre et le nombre de tentatives suivent l'horloge du SERVEUR ; la copie rendue est figée
 * avec son empreinte SHA-256 et corrigée automatiquement dans la même transaction (ADR-0007).
 */
export class AttemptService {
  constructor(private readonly deps: AssessmentDependencies) {}

  /** Les épreuves attribuées à l'élève connecté, avec leur état. */
  async myAssignments(actor: Actor): Promise<AssignmentSummary[]> {
    if (actor.kind !== "learner") return [];
    const learnerId = actor.id;
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assignments = await store.assignments();
      const assessments = await store.assessments();
      const attempts = await store.attemptsOfLearners([learnerId]);
      const titles = new Map(assessments.map((assessment) => [assessment.id, assessment.title]));
      return assignments
        .filter((assignment) => assignment.learnerIds.includes(learnerId))
        .map((assignment) => {
          const mine = attempts
            .filter((attempt) => attempt.assignmentId === assignment.id)
            .sort((a, b) => b.number - a.number);
          const latest = mine[0];
          const open = now >= assignment.opensAt && (now < assignment.dueAt || assignment.lateAllowed);
          const state: AssignmentSummary["state"] =
            latest?.status === "draft"
              ? "in_progress"
              : latest?.status === "published"
                ? "published"
                : latest !== undefined
                  ? "submitted"
                  : now < assignment.opensAt
                    ? "upcoming"
                    : open
                      ? "open"
                      : "closed";
          return {
            assignmentId: assignment.id,
            title: titles.get(assignment.assessmentId) ?? "",
            opensAt: assignment.opensAt.toISOString(),
            dueAt: assignment.dueAt.toISOString(),
            lateAllowed: assignment.lateAllowed,
            attemptsLeft: Math.max(0, assignment.maxAttempts - mine.length),
            state,
            currentAttemptId: latest?.id ?? null,
            // La note n'apparaît qu'après la publication (R5).
            grade: latest?.status === "published" ? latest.grade : null,
          };
        })
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    });
  }

  /** Commence une tentative, ou reprend celle en cours (une seule tentative en cours à la fois, M6). */
  async start(actor: Actor, assignmentId: AssignmentId): Promise<LearnerAttemptView> {
    const context = await this.#context(actor, assignmentId);
    await authorize(
      this.deps,
      actor,
      canWorkOnAssignment(actor, context === null ? null : new Set(context.assignment.learnerIds)),
      "assessment.start",
      assignmentId,
    );
    if (context === null || actor.kind !== "learner") throw new NotFoundError();
    const learnerId = actor.id;
    const { assignment, assessment } = context;
    for (let tries = 0; tries < 2; tries++) {
      const view = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
        const attempts = await store.attemptsOf(assignmentId, learnerId);
        const draft = attempts.find((attempt) => attempt.status === "draft");
        if (draft !== undefined)
          return attemptForLearner(assessment, assignment, draft, null, false, {
            scenes: await store.notebookScenesOf(draft.id),
            annotations: null,
          });
        assertCanStart(assignment, this.deps.clock.now(), attempts.length);
        const attempt = this.#newAttempt(assessment, assignment, learnerId, attempts.length + 1);
        // Deux démarrages simultanés : le second se heurte au numéro unique et recommence (R5).
        if (!(await store.insertAttempt(attempt))) return null;
        return attemptForLearner(assessment, assignment, attempt, null, false, NO_NOTEBOOK);
      });
      if (view !== null) return view;
    }
    throw new AttemptRefusedError("assessment.no-attempts-left");
  }

  /**
   * La copie de l'élève (ou, pour le parent lié, après publication) : la note après la publication,
   * le corrigé seulement après sa révélation (R5, verdict L3 R-1).
   */
  async view(actor: Actor, attemptId: AttemptId): Promise<LearnerAttemptView> {
    const found = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const attempt = await store.attemptById(attemptId);
      if (attempt === null) return null;
      const assignment = await store.assignmentById(attempt.assignmentId);
      const assessment = assignment === null ? null : await store.assessmentById(assignment.assessmentId);
      if (assignment === null || assessment === null) return null;
      return {
        attempt,
        assignment,
        assessment,
        results: attempt.status === "published" ? await store.resultsOf(attemptId) : [],
        scenes: await store.notebookScenesOf(attemptId),
        // Le calque du tuteur n'est montré qu'avec la correction publiée (R5, R6).
        annotations: attempt.status === "published" ? await store.annotationsOf(attemptId) : null,
      };
    });
    await authorize(
      this.deps,
      actor,
      canViewAttempt(
        actor,
        found === null
          ? null
          : { learnerId: found.attempt.learnerId, published: found.attempt.status === "published" },
      ),
      "assessment.view-attempt",
      attemptId,
    );
    if (found === null) throw new NotFoundError();
    return attemptForLearner(
      found.assessment,
      found.assignment,
      found.attempt,
      found.attempt.status === "published" ? { results: found.results } : null,
      answersRevealed(found.assignment, this.deps.clock.now()),
      { scenes: found.scenes, annotations: found.annotations },
    );
  }

  /** Brouillon : au plus toutes les 5 s, dans la fenêtre, tant que la copie n'est pas rendue (R5, R15). */
  async saveDraft(
    actor: Actor,
    attemptId: AttemptId,
    raw: Readonly<Record<string, LearnerAnswerView>>,
  ): Promise<void> {
    const { attempt, assignment, assessment, mediaIds } = await this.#ownDraft(actor, attemptId);
    const now = this.deps.clock.now();
    assertCanWork(assignment, now);
    // Une seule cadence pour toute la copie, cahier compris : au plus une sauvegarde toutes les 5 s (R15).
    assertDraftSaveAllowed(attempt.lastSavedAt, now);
    const { answers, scenes } = translateAnswers(
      this.deps.hasher,
      assessment.questions,
      attempt,
      mediaIds,
      raw,
    );
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const current = await store.attemptById(attemptId);
      if (current?.status !== "draft") throw new AttemptRefusedError("assessment.attempt-submitted");
      // La scène est écrite AVANT l'empreinte qui la référence ; la base refuse toute scène d'une copie rendue (R6).
      for (const scene of scenes) await store.upsertNotebookScene(attemptId, scene, now);
      await store.saveDraft(attemptId, answers, now);
    });
  }

  /**
   * Rendre la copie : elle est figée (empreinte SHA-256), corrigée automatiquement côté serveur et,
   * si l'attribution le prévoit et que tout est corrigé, publiée — le tout dans UNE transaction.
   */
  async submit(
    actor: Actor,
    attemptId: AttemptId,
    raw?: Readonly<Record<string, LearnerAnswerView>>,
  ): Promise<LearnerAttemptView> {
    const { attempt, assignment, assessment, mediaIds } = await this.#ownDraft(actor, attemptId);
    const now = this.deps.clock.now();
    const { late } = assertCanWork(assignment, now);
    const { answers, scenes } =
      raw === undefined
        ? { answers: attempt.answers, scenes: [] }
        : translateAnswers(this.deps.hasher, assessment.questions, attempt, mediaIds, raw);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      // Dernière version des scènes écrite tant que la copie est encore un brouillon, puis figée avec elle.
      for (const scene of scenes) await store.upsertNotebookScene(attemptId, scene, now);
      const frozen: AttemptRecord = {
        ...attempt,
        status: "submitted",
        answers,
        answersSha256: this.deps.hasher.sha256(canonicalJson(answers)),
        submittedAt: now,
        late,
      };
      // Deux rendus simultanés : un seul passe (la condition « encore brouillon » est vérifiée par la base).
      if (!(await store.submit(frozen))) throw new AttemptRefusedError("assessment.attempt-submitted");
      const results = assessment.questions.map((question) => {
        const earned = autoGrade(question, answers[question.id]);
        return {
          questionId: question.id,
          earned,
          gradedBy: earned === null ? ("pending" as const) : ("auto" as const),
          comment: null,
          gradedAt: earned === null ? null : now,
        };
      });
      for (const result of results) await store.upsertResult(attemptId, result);
      const grade = gradeOutOf20(
        assessment.questions.map((question, index) => ({
          earned: results[index]?.earned ?? null,
          points: question.points,
        })),
      );
      let final: AttemptRecord = frozen;
      if (grade !== null) {
        await store.updateAttemptStatus(attemptId, "graded", grade, null);
        final = { ...frozen, status: "graded", grade };
        if (assignment.publication === "auto")
          final = await publishAttempt(this.deps, store, actor, assessment, assignment, final, results);
      }
      // CopieRendue : la série hebdomadaire, les points et le badge « Premier pas » (L6).
      await store.publish({
        id: this.deps.ids.next("EventId"),
        type: ATTEMPT_SUBMITTED,
        tutorSpaceId: actor.tutorSpaceId,
        occurredAt: now,
        payload: {
          attemptId,
          assignmentId: assignment.id,
          learnerId: attempt.learnerId,
          submittedAt: now.toISOString(),
          late,
        },
      });
      await store.audit(
        auditOf(this.deps, actor, "assessment.submitted", "success", {
          targetId: attemptId,
          ...(late ? { reasonCode: "late" } : {}),
        }),
      );
      return attemptForLearner(
        assessment,
        assignment,
        final,
        final.status === "published" ? { results } : null,
        answersRevealed(assignment, now),
        { scenes: await store.notebookScenesOf(attemptId), annotations: null },
      );
    });
  }

  /**
   * Import d'une image dans le cahier d'une copie en brouillon (R14) : même ingestion que les images de
   * cours (octets magiques, taille, réencodage WebP sans métadonnées), au plus 20 images par copie.
   */
  async uploadImage(
    actor: Actor,
    attemptId: AttemptId,
    bytes: Buffer,
  ): Promise<{ mediaId: NotebookMediaId; width: number; height: number }> {
    const { assignment, mediaIds } = await this.#ownDraft(actor, attemptId);
    assertCanWork(assignment, this.deps.clock.now());
    if (mediaIds.size >= MAX_NOTEBOOK_IMAGES)
      throw new InvalidAssessmentInput("assessment.invalid-too-many-images");
    // Débit par élève AVANT l'ingestion (verdict L4, S-1) : un élève ne monopolise pas la file commune
    // des imports, qui sert aussi le tuteur. Une tentative refusée ensuite (fichier invalide) compte quand même.
    const quota = this.deps.uploads.take(`learner:${actor.id}`, this.deps.clock.now());
    if (!quota.allowed) throw new TooManyUploadsError(quota.retryAfterSeconds);
    const image = await this.deps.images.ingest(bytes);
    const mediaId = this.deps.ids.next("NotebookMediaId");
    // Le fichier est écrit avant la ligne : une ligne ne désigne jamais un fichier absent.
    await this.deps.files.save(actor.tutorSpaceId, mediaId, image.webp);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      store.insertNotebookMedia({
        id: mediaId,
        attemptId,
        width: image.width,
        height: image.height,
        byteSize: image.webp.length,
        sha256: image.sha256,
        createdAt: this.deps.clock.now(),
      }),
    );
    return { mediaId, width: image.width, height: image.height };
  }

  /** Image d'un cahier : visible comme la copie qui la contient (R3, R14). */
  async readImage(actor: Actor, mediaId: NotebookMediaId): Promise<{ bytes: Buffer; sha256: string }> {
    const found = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const media = await store.notebookMediaById(mediaId);
      const attempt = media === null ? null : await store.attemptById(media.attemptId);
      return media === null || attempt === null ? null : { media, attempt };
    });
    await authorize(
      this.deps,
      actor,
      canViewAttempt(
        actor,
        found === null
          ? null
          : { learnerId: found.attempt.learnerId, published: found.attempt.status === "published" },
      ),
      "assessment.read-notebook-image",
      mediaId,
    );
    if (found === null) throw new NotFoundError();
    return { bytes: await this.deps.files.read(actor.tutorSpaceId, mediaId), sha256: found.media.sha256 };
  }

  async #context(
    actor: Actor,
    assignmentId: AssignmentId,
  ): Promise<{ assignment: AssignmentRecord; assessment: AssessmentRecord } | null> {
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assignment = await store.assignmentById(assignmentId);
      const assessment = assignment === null ? null : await store.assessmentById(assignment.assessmentId);
      return assignment === null || assessment === null ? null : { assignment, assessment };
    });
  }

  async #ownDraft(
    actor: Actor,
    attemptId: AttemptId,
  ): Promise<{
    attempt: AttemptRecord;
    assignment: AssignmentRecord;
    assessment: AssessmentRecord;
    mediaIds: ReadonlySet<string>;
  }> {
    const found = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const loaded = await loadAttempt(store, attemptId);
      if (loaded === null) return null;
      const media = await store.notebookMediaOf(attemptId);
      return { ...loaded, mediaIds: new Set<string>(media.map((item) => item.id)) };
    });
    await authorize(
      this.deps,
      actor,
      canWorkOnAssignment(actor, found === null ? null : new Set([found.attempt.learnerId])),
      "assessment.work-on-attempt",
      attemptId,
    );
    if (found === null) throw new NotFoundError();
    if (found.attempt.status !== "draft") throw new AttemptRefusedError("assessment.attempt-submitted");
    return found;
  }

  #newAttempt(
    assessment: AssessmentRecord,
    assignment: AssignmentRecord,
    learnerId: LearnerId,
    number: number,
  ): AttemptRecord {
    const optionAliases: Record<string, OptionAlias[]> = {};
    for (const question of assessment.questions) {
      if (question.spec.kind !== "mcq") continue;
      // Mélange de Fisher-Yates avec l'aléa du serveur ; alias opaques propres à la tentative (ADR-0007).
      const options = question.spec.options.map((option) => option.id);
      for (let index = options.length - 1; index > 0; index--) {
        const swap = this.deps.random.integer(index + 1);
        [options[index], options[swap]] = [options[swap] ?? "", options[index] ?? ""];
      }
      optionAliases[question.id] = options.map((optionId) => ({ alias: this.deps.random.token(), optionId }));
    }
    return {
      id: this.deps.ids.next("AttemptId"),
      assignmentId: assignment.id,
      learnerId,
      number,
      status: "draft",
      optionAliases,
      answers: {},
      answersSha256: null,
      startedAt: this.deps.clock.now(),
      lastSavedAt: null,
      submittedAt: null,
      late: false,
      grade: null,
      publishedAt: null,
    };
  }
}

export async function loadAttempt(
  store: AssessmentStore,
  attemptId: AttemptId,
): Promise<{ attempt: AttemptRecord; assignment: AssignmentRecord; assessment: AssessmentRecord } | null> {
  const attempt = await store.attemptById(attemptId);
  if (attempt === null) return null;
  const assignment = await store.assignmentById(attempt.assignmentId);
  const assessment = assignment === null ? null : await store.assessmentById(assignment.assessmentId);
  return assignment === null || assessment === null ? null : { attempt, assignment, assessment };
}

const NO_NOTEBOOK = { scenes: new Map(), annotations: null } as const;

/**
 * Réponses reçues de l'élève → réponses de la copie : seules les questions de l'épreuve, du bon type,
 * bornées ; les alias d'options sont traduits en vrais identifiants (un alias inconnu est ignoré).
 * Une scène de cahier est validée par le schéma fermé ; la copie n'en garde que l'empreinte (R6). Une
 * question de cahier absente de l'envoi garde sa scène déjà enregistrée.
 */
function translateAnswers(
  hasher: ContentHasher,
  questions: readonly Question[],
  attempt: AttemptRecord,
  mediaIds: ReadonlySet<string>,
  raw: Readonly<Record<string, LearnerAnswerView>>,
): { answers: Record<string, Answer>; scenes: StoredScene[] } {
  const answers: Record<string, Answer> = {};
  const scenes: StoredScene[] = [];
  for (const question of questions) {
    const given = raw[question.id];
    if (given === undefined) {
      const previous = attempt.answers[question.id];
      if (previous?.kind === "notebook") answers[question.id] = previous;
      continue;
    }
    if (given.kind !== question.spec.kind) throw new InvalidAssessmentInput("assessment.invalid-answer");
    switch (given.kind) {
      case "mcq": {
        const byAlias = new Map(
          (attempt.optionAliases[question.id] ?? []).map((entry) => [entry.alias, entry.optionId]),
        );
        const optionIds = [...new Set(given.optionIds)]
          .map((alias) => byAlias.get(alias))
          .filter((id): id is string => id !== undefined);
        answers[question.id] = { kind: "mcq", optionIds };
        break;
      }
      case "numeric":
        if (given.value.length > 32 || given.unit.length > 8)
          throw new InvalidAssessmentInput("assessment.invalid-answer");
        answers[question.id] = { kind: "numeric", value: given.value, unit: given.unit };
        break;
      case "short_text":
        if (given.text.length > MAX_TEXT_ANSWER)
          throw new InvalidAssessmentInput("assessment.invalid-answer");
        answers[question.id] = { kind: "short_text", text: given.text };
        break;
      case "notebook": {
        const scene = storedScene(hasher, question.id, given, { mediaIds });
        scenes.push(scene);
        answers[question.id] = { kind: "notebook", sceneSha256: scene.sha256 };
        break;
      }
    }
  }
  return { answers, scenes };
}
