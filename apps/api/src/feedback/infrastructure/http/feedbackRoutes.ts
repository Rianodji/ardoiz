import {
  HandleSuggestionRequest,
  IdResponse,
  NewSuggestionRequest,
  SuggestionsResponse,
  SuggestionView,
} from "@ardoiz/contracts";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "typebox";
import { actorOf } from "../../../identity/index.js";
import { SuggestionId } from "../../../shared-kernel/ids.js";
import type { SuggestionRecord, SuggestionService } from "../../application/SuggestionService.js";

const closed = { additionalProperties: false } as const;
const SuggestionParams = Type.Object({ suggestionId: Type.String({ maxLength: 60 }) }, closed);

const view = (suggestion: SuggestionRecord) => ({
  ...suggestion,
  createdAt: suggestion.createdAt.toISOString(),
  updatedAt: suggestion.updatedAt?.toISOString() ?? null,
});

/** Routes HTTP des suggestions. Chaque corps et chaque paramètre ont un schéma fermé (règle 5). */
export function feedbackRoutes(app: FastifyInstance, suggestions: SuggestionService): Promise<void> {
  app.post<{ Body: Static<typeof NewSuggestionRequest> }>(
    "/api/suggestions",
    { schema: { body: NewSuggestionRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const sent = await suggestions.send(actorOf(request), request.body.category, request.body.body);
      return reply.code(201).send({ id: sent.id });
    },
  );

  app.get("/api/suggestions", { schema: { response: { 200: SuggestionsResponse } } }, async (request) => ({
    suggestions: (await suggestions.list(actorOf(request))).map(view),
  }));

  app.get<{ Params: Static<typeof SuggestionParams> }>(
    "/api/suggestions/:suggestionId",
    { schema: { params: SuggestionParams, response: { 200: SuggestionView } } },
    async (request) =>
      view(await suggestions.get(actorOf(request), SuggestionId(request.params.suggestionId))),
  );

  app.patch<{ Params: Static<typeof SuggestionParams>; Body: Static<typeof HandleSuggestionRequest> }>(
    "/api/suggestions/:suggestionId",
    { schema: { params: SuggestionParams, body: HandleSuggestionRequest } },
    async (request, reply) => {
      await suggestions.handle(
        actorOf(request),
        SuggestionId(request.params.suggestionId),
        request.body.status,
        request.body.reply,
      );
      return reply.code(204).send();
    },
  );

  return Promise.resolve();
}
