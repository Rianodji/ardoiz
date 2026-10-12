import { Type, type Static } from "typebox";

/**
 * Contrats HTTP du module curriculum (règle 5). Le contenu d'un cours est validé en entier par le
 * schéma fermé de `@ardoiz/content-schema` (R4) : ici, seule sa présence est vérifiée.
 */
const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 5, maxLength: 60 });
const Text = (max: number) => Type.String({ minLength: 1, maxLength: max });
const DateTime = Type.String({ format: "date-time" });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);

export const NewCompetencyRequest = Type.Object({ domainId: Id, label: Text(200) }, closed);
export const CompetencyChangeRequest = Type.Object(
  { label: Type.Optional(Text(200)), position: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })) },
  closed,
);
export const NewModuleRequest = Type.Object({ subjectId: Id, title: Text(120) }, closed);
export const NewLessonRequest = Type.Object({ moduleId: Id, title: Text(120) }, closed);
export const TitleChangeRequest = Type.Object(
  { title: Type.Optional(Text(120)), position: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })) },
  closed,
);
export const LessonContentRequest = Type.Object({ content: Type.Unknown() }, closed);
export const NewGroupRequest = Type.Object({ name: Text(60) }, closed);
export const GroupMembersRequest = Type.Object({ learnerIds: Type.Array(Id, { maxItems: 200 }) }, closed);
export const UnlockRequest = Type.Object(
  {
    target: Type.Object(
      { kind: Type.Union([Type.Literal("module"), Type.Literal("lesson")]), id: Id },
      closed,
    ),
    audience: Type.Object(
      { kind: Type.Union([Type.Literal("learner"), Type.Literal("group")]), id: Id },
      closed,
    ),
  },
  closed,
);

export const IdResponse = Type.Object({ id: Type.String() }, closed);
export const MediaResponse = Type.Object(
  { mediaId: Type.String(), width: Type.Integer(), height: Type.Integer() },
  closed,
);

export const ReferentialResponse = Type.Object(
  {
    subjects: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String(), position: Type.Integer() }, closed),
    ),
    domains: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          subjectId: Type.String(),
          prefix: Type.String(),
          label: Type.String(),
          position: Type.Integer(),
        },
        closed,
      ),
    ),
    competencies: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          domainId: Type.String(),
          code: Type.String(),
          label: Type.String(),
          position: Type.Integer(),
          archivedAt: Nullable(DateTime),
        },
        closed,
      ),
    ),
  },
  closed,
);
export type ReferentialResponse = Static<typeof ReferentialResponse>;

export const CompetencyChoicesResponse = Type.Object(
  {
    competencies: Type.Array(
      Type.Object({ id: Type.String(), code: Type.String(), label: Type.String() }, closed),
    ),
  },
  closed,
);
export type CompetencyChoicesResponse = Static<typeof CompetencyChoicesResponse>;

export const ProgrammeResponse = Type.Object(
  {
    subjects: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String(), position: Type.Integer() }, closed),
    ),
    modules: Type.Array(
      Type.Object(
        { id: Type.String(), subjectId: Type.String(), title: Type.String(), position: Type.Integer() },
        closed,
      ),
    ),
    lessons: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          moduleId: Type.String(),
          title: Type.String(),
          status: Type.Union([Type.Literal("draft"), Type.Literal("published")]),
          position: Type.Integer(),
          updatedAt: DateTime,
          publishedAt: Nullable(DateTime),
        },
        closed,
      ),
    ),
  },
  closed,
);
export type ProgrammeResponse = Static<typeof ProgrammeResponse>;

export const AuthorLessonResponse = Type.Object(
  {
    id: Type.String(),
    moduleId: Type.String(),
    title: Type.String(),
    status: Type.Union([Type.Literal("draft"), Type.Literal("published")]),
    content: Type.Unknown(),
  },
  closed,
);
export type AuthorLessonResponse = Static<typeof AuthorLessonResponse>;

export const LessonResponse = Type.Object(
  { id: Type.String(), title: Type.String(), content: Type.Unknown() },
  closed,
);
export type LessonResponse = Static<typeof LessonResponse>;

export const GroupsResponse = Type.Object(
  {
    groups: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String(), learnerIds: Type.Array(Type.String()) }, closed),
    ),
  },
  closed,
);
export type GroupsResponse = Static<typeof GroupsResponse>;

export const UnlocksResponse = Type.Object(
  {
    unlocks: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          target: Type.Object({ kind: Type.String(), id: Type.String() }, closed),
          audience: Type.Object({ kind: Type.String(), id: Type.String() }, closed),
          unlockedAt: DateTime,
        },
        closed,
      ),
    ),
  },
  closed,
);
export type UnlocksResponse = Static<typeof UnlocksResponse>;

export const LearnerProgrammeResponse = Type.Object(
  {
    subjects: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          name: Type.String(),
          modules: Type.Array(
            Type.Object(
              {
                id: Type.String(),
                title: Type.String(),
                lessons: Type.Array(
                  Type.Object(
                    { id: Type.String(), title: Type.String(), completedAt: Nullable(DateTime) },
                    closed,
                  ),
                ),
              },
              closed,
            ),
          ),
        },
        closed,
      ),
    ),
  },
  closed,
);
export type LearnerProgrammeResponse = Static<typeof LearnerProgrammeResponse>;
