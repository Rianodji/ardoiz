import { Type } from "typebox";

/**
 * Contrats HTTP de la planification (règle 5). Le lien de visio n'apparaît que dans `meetingLink`,
 * rempli par le serveur pour le tuteur, ou pour l'élève participant de T−15 min à la fin (R9).
 */
const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 5, maxLength: 60 });
const LocalDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const LocalTime = Type.String({ pattern: "^\\d{2}:\\d{2}$" });
const DateTime = Type.String({ format: "date-time" });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);
const Link = Type.String({ minLength: 1, maxLength: 500 });

export const PlanSessionRequest = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    audience: Type.Object(
      { kind: Type.Union([Type.Literal("learner"), Type.Literal("group")]), id: Id },
      closed,
    ),
    schedule: Type.Object(
      {
        kind: Type.Union([Type.Literal("once"), Type.Literal("weekly")]),
        date: LocalDate,
        time: LocalTime,
        durationMinutes: Type.Integer({ minimum: 15, maximum: 240 }),
        until: Type.Optional(LocalDate),
      },
      closed,
    ),
    // Absent : une salle Jitsi au nom imprévisible est générée.
    link: Type.Optional(Link),
  },
  closed,
);
export const MoveOccurrenceRequest = Type.Object(
  { date: LocalDate, time: LocalTime, durationMinutes: Type.Integer({ minimum: 15, maximum: 240 }) },
  closed,
);
export const CancelOccurrenceRequest = Type.Object({ wholeSeries: Type.Boolean() }, closed);
export const ChangeLinkRequest = Type.Object({ link: Type.Optional(Link) }, closed);
// Paramètres de requête : du texte (aucune conversion implicite de type) ; `days` est borné par le service.
export const AgendaQuery = Type.Object(
  { from: LocalDate, days: Type.String({ pattern: "^[0-9]{1,2}$" }) },
  closed,
);

export const OccurrenceView = Type.Object(
  {
    occurrenceId: Type.String(),
    sessionId: Type.String(),
    title: Type.String(),
    startsAt: DateTime,
    endsAt: DateTime,
    local: Type.Object({ date: Type.String(), start: Type.String(), end: Type.String() }, closed),
    status: Type.Union([Type.Literal("scheduled"), Type.Literal("cancelled")]),
    moved: Type.Boolean(),
    participantIds: Type.Array(Type.String()),
    linkAvailableFrom: DateTime,
    meetingLink: Nullable(Type.String()),
  },
  closed,
);
export const AgendaResponse = Type.Object({ occurrences: Type.Array(OccurrenceView) }, closed);
export const JoinResponse = Type.Object({ meetingLink: Type.String() }, closed);
export const TutorSessionsResponse = Type.Object(
  {
    sessions: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          title: Type.String(),
          meetingLink: Type.String(),
          linkToReplace: Type.Boolean(),
          kind: Type.Union([Type.Literal("once"), Type.Literal("weekly")]),
          learnerIds: Type.Array(Type.String()),
          occurrences: Type.Array(OccurrenceView),
        },
        closed,
      ),
    ),
  },
  closed,
);
