import {
  AnnotationRequest,
  AnswersRequest,
  NotebookMediaResponse,
  AssignmentRequest,
  AssignmentsResponse,
  AuthorAssessmentResponse,
  AuthorAssessmentsResponse,
  GradeRequest,
  GradingQueueResponse,
  IdResponse,
  LearnerAssignmentsResponse,
  LearnerAttemptResponse,
  NewAssessmentRequest,
  PublishedResultsResponse,
  QuestionsRequest,
  RectificationRequest,
  SubmitRequest,
  TutorAttemptResponse,
} from "@ardoiz/contracts";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "typebox";
import { actorOf } from "../../../identity/index.js";
import {
  AssessmentId,
  AssignmentId,
  AttemptId,
  GroupId,
  LearnerId,
  NotebookMediaId,
  QuestionId,
  SubjectId,
} from "../../../shared-kernel/ids.js";
import { MAX_IMAGE_BYTES } from "../../../platform/media/SharpImageIngestion.js";
import type { AttemptService } from "../../application/AttemptService.js";
import type { AuthoringService } from "../../application/AuthoringService.js";
import type { GradingService } from "../../application/GradingService.js";

export interface AssessmentHttpServices {
  readonly authoring: AuthoringService;
  readonly attempts: AttemptService;
  readonly grading: GradingService;
}

/** Statut HTTP des codes d'erreur de l'évaluation. */
export const ASSESSMENT_STATUSES: Readonly<Record<string, number>> = {
  "assessment.not-yet-open": 409,
  "assessment.closed": 409,
  "assessment.no-attempts-left": 409,
  "assessment.attempt-submitted": 409,
  "assessment.locked": 409,
  "assessment.not-gradable": 409,
  "assessment.grading-incomplete": 409,
  "assessment.already-published": 409,
  "assessment.not-published": 409,
  // Scène de plus de 2 000 éléments ou de 5 Mo : « cahier trop volumineux » (R15).
  "assessment.notebook-too-large": 413,
};

const closed = { additionalProperties: false } as const;
const params = <K extends string>(key: K) =>
  Type.Object({ [key]: Type.String({ maxLength: 60 }) } as Record<K, ReturnType<typeof Type.String>>, closed);
const AssessmentParams = params("assessmentId");
const AssignmentParams = params("assignmentId");
const AttemptParams = params("attemptId");
const LearnerParams = params("learnerId");
const NotebookMediaParams = params("mediaId");
const AnnotationParams = Type.Object(
  { attemptId: Type.String({ maxLength: 60 }), questionId: Type.String({ maxLength: 60 }) },
  closed,
);

/** Corps des routes qui portent une scène du cahier : 5 Mo de scène et la marge du reste de la copie (R15). */
export const NOTEBOOK_BODY_LIMIT = 5 * 1024 * 1024 + 256 * 1024;

/** Routes HTTP de l'évaluation. Chaque corps et chaque paramètre ont un schéma fermé (règle 5). */
export async function assessmentRoutes(
  app: FastifyInstance,
  services: AssessmentHttpServices,
): Promise<void> {
  const { authoring, attempts, grading } = services;

  // --- Épreuves et attributions (tuteur) -------------------------------------------------------
  app.get(
    "/api/assessments",
    { schema: { response: { 200: AuthorAssessmentsResponse } } },
    async (request) => ({
      assessments: await authoring.list(actorOf(request)),
    }),
  );

  app.post<{ Body: Static<typeof NewAssessmentRequest> }>(
    "/api/assessments",
    { schema: { body: NewAssessmentRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const assessment = await authoring.create(
        actorOf(request),
        SubjectId(request.body.subjectId),
        request.body.title,
      );
      return reply.code(201).send({ id: assessment.id });
    },
  );

  app.get<{ Params: Static<typeof AssessmentParams> }>(
    "/api/assessments/:assessmentId",
    { schema: { params: AssessmentParams, response: { 200: AuthorAssessmentResponse } } },
    async (request) => authoring.get(actorOf(request), AssessmentId(request.params.assessmentId)),
  );

  app.put<{ Params: Static<typeof AssessmentParams>; Body: Static<typeof QuestionsRequest> }>(
    "/api/assessments/:assessmentId/questions",
    { schema: { params: AssessmentParams, body: QuestionsRequest } },
    async (request, reply) => {
      await authoring.replaceQuestions(
        actorOf(request),
        AssessmentId(request.params.assessmentId),
        request.body.questions,
      );
      return reply.code(204).send();
    },
  );

  app.get("/api/assignments", { schema: { response: { 200: AssignmentsResponse } } }, async (request) => ({
    assignments: (await authoring.assignments(actorOf(request))).map((assignment) => ({
      id: assignment.id,
      assessmentId: assignment.assessmentId,
      opensAt: assignment.opensAt.toISOString(),
      dueAt: assignment.dueAt.toISOString(),
      maxAttempts: assignment.maxAttempts,
      lateAllowed: assignment.lateAllowed,
      publication: assignment.publication,
      learnerIds: [...assignment.learnerIds],
      revealedAt: assignment.revealedAt?.toISOString() ?? null,
    })),
  }));

  app.post<{ Body: Static<typeof AssignmentRequest> }>(
    "/api/assignments",
    { schema: { body: AssignmentRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const { body } = request;
      const assignment = await authoring.assign(actorOf(request), {
        assessmentId: AssessmentId(body.assessmentId),
        audience:
          body.audience.kind === "learner"
            ? { kind: "learner", id: LearnerId(body.audience.id) }
            : { kind: "group", id: GroupId(body.audience.id) },
        opensAt: new Date(body.opensAt),
        dueAt: new Date(body.dueAt),
        maxAttempts: body.maxAttempts,
        lateAllowed: body.lateAllowed,
        publication: body.publication,
      });
      return reply.code(201).send({ id: assignment.id });
    },
  );

  app.post<{ Params: Static<typeof AssignmentParams> }>(
    "/api/assignments/:assignmentId/reveal",
    { schema: { params: AssignmentParams } },
    async (request, reply) => {
      await grading.reveal(actorOf(request), AssignmentId(request.params.assignmentId));
      return reply.code(204).send();
    },
  );

  // --- Passage (élève) : réponses sans aucune réponse attendue (R5) ------------------------------
  app.get(
    "/api/my/assignments",
    { schema: { response: { 200: LearnerAssignmentsResponse } } },
    async (request) => ({
      assignments: await attempts.myAssignments(actorOf(request)),
    }),
  );

  app.post<{ Params: Static<typeof AssignmentParams> }>(
    "/api/my/assignments/:assignmentId/attempt",
    { schema: { params: AssignmentParams, response: { 200: LearnerAttemptResponse } } },
    async (request) => attempts.start(actorOf(request), AssignmentId(request.params.assignmentId)),
  );

  app.get<{ Params: Static<typeof AttemptParams> }>(
    "/api/attempts/:attemptId",
    { schema: { params: AttemptParams, response: { 200: LearnerAttemptResponse } } },
    async (request) => attempts.view(actorOf(request), AttemptId(request.params.attemptId)),
  );

  app.put<{ Params: Static<typeof AttemptParams>; Body: Static<typeof AnswersRequest> }>(
    "/api/attempts/:attemptId/answers",
    { schema: { params: AttemptParams, body: AnswersRequest }, bodyLimit: NOTEBOOK_BODY_LIMIT },
    async (request, reply) => {
      await attempts.saveDraft(actorOf(request), AttemptId(request.params.attemptId), request.body.answers);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof AttemptParams>; Body: Static<typeof SubmitRequest> }>(
    "/api/attempts/:attemptId/submit",
    {
      schema: { params: AttemptParams, body: SubmitRequest, response: { 200: LearnerAttemptResponse } },
      bodyLimit: NOTEBOOK_BODY_LIMIT,
    },
    async (request) =>
      attempts.submit(actorOf(request), AttemptId(request.params.attemptId), request.body.answers),
  );

  app.get<{ Params: Static<typeof LearnerParams> }>(
    "/api/learners/:learnerId/results",
    { schema: { params: LearnerParams, response: { 200: PublishedResultsResponse } } },
    async (request) => ({
      results: await grading.publishedResults(actorOf(request), LearnerId(request.params.learnerId)),
    }),
  );

  // --- Correction (tuteur) -----------------------------------------------------------------------
  app.get(
    "/api/grading/attempts",
    { schema: { response: { 200: GradingQueueResponse } } },
    async (request) => ({
      attempts: await grading.queue(actorOf(request)),
    }),
  );

  app.get<{ Params: Static<typeof AttemptParams> }>(
    "/api/grading/attempts/:attemptId",
    { schema: { params: AttemptParams, response: { 200: TutorAttemptResponse } } },
    async (request) => grading.detail(actorOf(request), AttemptId(request.params.attemptId)),
  );

  app.post<{ Params: Static<typeof AttemptParams>; Body: Static<typeof GradeRequest> }>(
    "/api/grading/attempts/:attemptId/grades",
    { schema: { params: AttemptParams, body: GradeRequest } },
    async (request, reply) => {
      await grading.grade(
        actorOf(request),
        AttemptId(request.params.attemptId),
        request.body.grades.map((entry) => ({
          questionId: QuestionId(entry.questionId),
          earned: entry.earned,
          comment: entry.comment,
        })),
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof AttemptParams> }>(
    "/api/grading/attempts/:attemptId/publish",
    { schema: { params: AttemptParams } },
    async (request, reply) => {
      await grading.publish(actorOf(request), AttemptId(request.params.attemptId));
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof AttemptParams>; Body: Static<typeof RectificationRequest> }>(
    "/api/grading/attempts/:attemptId/rectifications",
    { schema: { params: AttemptParams, body: RectificationRequest } },
    async (request, reply) => {
      const { questionId, earned, reason } = request.body;
      await grading.rectify(
        actorOf(request),
        AttemptId(request.params.attemptId),
        QuestionId(questionId),
        earned,
        reason,
      );
      return reply.code(204).send();
    },
  );
  // --- Cahier virtuel (ADR-0004) -----------------------------------------------------------------
  app.put<{ Params: Static<typeof AnnotationParams>; Body: Static<typeof AnnotationRequest> }>(
    "/api/grading/attempts/:attemptId/annotations/:questionId",
    { schema: { params: AnnotationParams, body: AnnotationRequest }, bodyLimit: NOTEBOOK_BODY_LIMIT },
    async (request, reply) => {
      await grading.annotate(
        actorOf(request),
        AttemptId(request.params.attemptId),
        QuestionId(request.params.questionId),
        request.body,
      );
      return reply.code(204).send();
    },
  );

  // Import d'image dans le cahier : seule route de l'évaluation qui reçoit des octets bruts (R14, R15).
  await app.register((scoped, _options, done) => {
    scoped.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scoped.post<{ Params: Static<typeof AttemptParams>; Body: Buffer }>(
      "/api/attempts/:attemptId/media",
      {
        schema: { params: AttemptParams, response: { 201: NotebookMediaResponse } },
        bodyLimit: MAX_IMAGE_BYTES,
      },
      async (request, reply) => {
        const uploaded = await attempts.uploadImage(
          actorOf(request),
          AttemptId(request.params.attemptId),
          request.body,
        );
        return reply.code(201).send(uploaded);
      },
    );
    done();
  });

  /** Image d'un cahier (R3, R14) : visible comme la copie qui la contient ; type fixé, nom généré. */
  app.get<{ Params: Static<typeof NotebookMediaParams> }>(
    "/api/notebook-media/:mediaId",
    { schema: { params: NotebookMediaParams } },
    async (request, reply) => {
      const mediaId = NotebookMediaId(request.params.mediaId);
      const { bytes, sha256 } = await attempts.readImage(actorOf(request), mediaId);
      return reply
        .type("image/webp")
        .header("content-disposition", `inline; filename="${mediaId}.webp"`)
        .header("etag", `"${sha256}"`)
        .send(bytes);
    },
  );
}
