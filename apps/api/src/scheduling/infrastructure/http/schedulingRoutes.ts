import {
  AgendaQuery,
  AgendaResponse,
  CancelOccurrenceRequest,
  ChangeLinkRequest,
  IdResponse,
  JoinResponse,
  MoveOccurrenceRequest,
  OccurrenceView,
  PlanSessionRequest,
  TutorSessionsResponse,
} from "@ardoiz/contracts";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "typebox";
import { actorOf } from "../../../identity/index.js";
import { GroupId, LearnerId, SessionOccurrenceId, TutoringSessionId } from "../../../shared-kernel/ids.js";
import type { SchedulingService } from "../../application/SchedulingService.js";

/** Statut HTTP des codes d'erreur de la planification. */
export const SCHEDULING_STATUSES: Readonly<Record<string, number>> = {
  "scheduling.in-the-past": 409,
  "scheduling.already-ended": 409,
  "scheduling.cancelled": 409,
  "scheduling.link-not-available": 409,
  // Lien relu en base devenu invalide (verdict L5, S-1) : non servi, le tuteur doit le remplacer.
  "scheduling.link-to-replace": 409,
};

const closed = { additionalProperties: false } as const;
const OccurrenceParams = Type.Object({ occurrenceId: Type.String({ maxLength: 60 }) }, closed);
const SessionParams = Type.Object({ sessionId: Type.String({ maxLength: 60 }) }, closed);

/** Routes HTTP de la planification. Chaque corps, paramètre et requête ont un schéma fermé (règle 5). */
export function schedulingRoutes(app: FastifyInstance, scheduling: SchedulingService): Promise<void> {
  // --- Tuteur ----------------------------------------------------------------------------------
  app.get("/api/sessions", { schema: { response: { 200: TutorSessionsResponse } } }, async (request) => ({
    sessions: (await scheduling.sessions(actorOf(request))).map(({ session, occurrences }) => ({
      id: session.id,
      title: session.title,
      // Le tuteur voit la valeur stockée comme du texte ; `linkToReplace` dit si elle est encore servie.
      meetingLink: session.meetingLink,
      linkToReplace: scheduling.servedLink(session) === null,
      kind: session.recurrence.kind,
      learnerIds: [...session.learnerIds],
      occurrences,
    })),
  }));

  app.post<{ Body: Static<typeof PlanSessionRequest> }>(
    "/api/sessions",
    { schema: { body: PlanSessionRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const { body } = request;
      const session = await scheduling.plan(actorOf(request), {
        title: body.title,
        audience:
          body.audience.kind === "learner"
            ? { kind: "learner", id: LearnerId(body.audience.id) }
            : { kind: "group", id: GroupId(body.audience.id) },
        schedule: body.schedule,
        link: body.link,
      });
      return reply.code(201).send({ id: session.id });
    },
  );

  app.put<{ Params: Static<typeof SessionParams>; Body: Static<typeof ChangeLinkRequest> }>(
    "/api/sessions/:sessionId/link",
    { schema: { params: SessionParams, body: ChangeLinkRequest } },
    async (request, reply) => {
      await scheduling.changeLink(
        actorOf(request),
        TutoringSessionId(request.params.sessionId),
        request.body.link,
      );
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: Static<typeof OccurrenceParams>; Body: Static<typeof MoveOccurrenceRequest> }>(
    "/api/occurrences/:occurrenceId",
    { schema: { params: OccurrenceParams, body: MoveOccurrenceRequest } },
    async (request, reply) => {
      await scheduling.move(actorOf(request), SessionOccurrenceId(request.params.occurrenceId), request.body);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof OccurrenceParams>; Body: Static<typeof CancelOccurrenceRequest> }>(
    "/api/occurrences/:occurrenceId/cancel",
    { schema: { params: OccurrenceParams, body: CancelOccurrenceRequest } },
    async (request, reply) => {
      await scheduling.cancel(
        actorOf(request),
        SessionOccurrenceId(request.params.occurrenceId),
        request.body.wholeSeries,
      );
      return reply.code(204).send();
    },
  );

  // --- Agenda (élève, parent, tuteur) : jamais de lien ------------------------------------------
  app.get<{ Querystring: Static<typeof AgendaQuery> }>(
    "/api/agenda",
    { schema: { querystring: AgendaQuery, response: { 200: AgendaResponse } } },
    async (request) => ({
      occurrences: await scheduling.agenda(actorOf(request), request.query.from, Number(request.query.days)),
    }),
  );

  app.get<{ Params: Static<typeof OccurrenceParams> }>(
    "/api/occurrences/:occurrenceId",
    { schema: { params: OccurrenceParams, response: { 200: OccurrenceView } } },
    async (request) =>
      scheduling.occurrence(actorOf(request), SessionOccurrenceId(request.params.occurrenceId)),
  );

  /** Rejoindre : le lien, et la présence de l'élève notée une fois (R9, SéanceRejointe). */
  app.post<{ Params: Static<typeof OccurrenceParams> }>(
    "/api/occurrences/:occurrenceId/join",
    { schema: { params: OccurrenceParams, response: { 200: JoinResponse } } },
    async (request) => scheduling.join(actorOf(request), SessionOccurrenceId(request.params.occurrenceId)),
  );

  return Promise.resolve();
}
