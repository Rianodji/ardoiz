import {
  AnswersRequest,
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
  QuestionId,
  SubjectId,
} from "../../../shared-kernel/ids.js";
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
};

const closed = { additionalProperties: false } as const;
const params = <K extends string>(key: K) =>
  Type.Object({ [key]: Type.String({ maxLength: 60 }) } as Record<K, ReturnType<typeof Type.String>>, closed);
const AssessmentParams = params("assessmentId");
const AssignmentParams = params("assignmentId");
const AttemptParams = params("attemptId");
const LearnerParams = params("learnerId");

/** Routes HTTP de l'évaluation. Chaque corps et chaque paramètre ont un schéma fermé (règle 5). */
export function assessmentRoutes(app: FastifyInstance, services: AssessmentHttpServices): Promise<void> {
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
    { schema: { params: AttemptParams, body: AnswersRequest } },
    async (request, reply) => {
      await attempts.saveDraft(actorOf(request), AttemptId(request.params.attemptId), request.body.answers);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof AttemptParams>; Body: Static<typeof SubmitRequest> }>(
    "/api/attempts/:attemptId/submit",
    { schema: { params: AttemptParams, body: SubmitRequest, response: { 200: LearnerAttemptResponse } } },
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
  return Promise.resolve();
}
