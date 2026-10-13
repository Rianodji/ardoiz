import { AdjustLevelRequest, LearnerProgressResponse, ProgressOverviewResponse } from "@ardoiz/contracts";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "typebox";
import { actorOf } from "../../../identity/index.js";
import { CompetencyId, LearnerId } from "../../../shared-kernel/ids.js";
import type { ProgressService } from "../../application/ProgressService.js";

const closed = { additionalProperties: false } as const;
const LearnerParams = Type.Object({ learnerId: Type.String({ maxLength: 60 }) }, closed);
const AdjustParams = Type.Object(
  { learnerId: Type.String({ maxLength: 60 }), competencyId: Type.String({ maxLength: 60 }) },
  closed,
);

/** Routes HTTP de la progression. Chaque corps et chaque paramètre ont un schéma fermé (règle 5). */
export function progressRoutes(app: FastifyInstance, progress: ProgressService): Promise<void> {
  app.get<{ Params: Static<typeof LearnerParams> }>(
    "/api/learners/:learnerId/progress",
    { schema: { params: LearnerParams, response: { 200: LearnerProgressResponse } } },
    async (request) => progress.learnerProgress(actorOf(request), LearnerId(request.params.learnerId)),
  );

  app.put<{ Params: Static<typeof AdjustParams>; Body: Static<typeof AdjustLevelRequest> }>(
    "/api/learners/:learnerId/competencies/:competencyId/level",
    { schema: { params: AdjustParams, body: AdjustLevelRequest } },
    async (request, reply) => {
      await progress.adjust(
        actorOf(request),
        LearnerId(request.params.learnerId),
        CompetencyId(request.params.competencyId),
        request.body.level,
        request.body.justification,
      );
      return reply.code(204).send();
    },
  );

  app.get(
    "/api/progress/overview",
    { schema: { response: { 200: ProgressOverviewResponse } } },
    async (request) => progress.overview(actorOf(request)),
  );

  return Promise.resolve();
}
