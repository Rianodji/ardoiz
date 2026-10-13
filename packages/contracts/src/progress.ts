import { Type } from "typebox";

/**
 * Contrats HTTP de la progression (règle 5). Les réponses destinées à un élève ou à un parent ne
 * portent que les données d'UN élève : ni classement, ni comparaison, ni moyenne de groupe (R17).
 */
const closed = { additionalProperties: false } as const;
const DateTime = Type.String({ format: "date-time" });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);
const Level = Type.Union([
  Type.Literal("not_assessed"),
  Type.Literal("not_acquired"),
  Type.Literal("in_progress"),
  Type.Literal("acquired"),
  Type.Literal("exceeded"),
]);
const Badge = Type.Union([
  Type.Literal("first-step"),
  Type.Literal("geometer"),
  Type.Literal("units-master"),
  Type.Literal("assiduous"),
  Type.Literal("persevering"),
]);
const Streak = Type.Object({ current: Type.Integer(), best: Type.Integer(), paused: Type.Boolean() }, closed);

export const LearnerProgressResponse = Type.Object(
  {
    learnerId: Type.String(),
    xp: Type.Integer(),
    level: Type.Integer(),
    currentLevelXp: Type.Integer(),
    nextLevelXp: Type.Integer(),
    streak: Streak,
    badges: Type.Array(Type.Object({ badge: Badge, awardedAt: DateTime }, closed)),
    competencies: Type.Array(
      Type.Object(
        {
          competencyId: Type.String(),
          code: Type.String(),
          label: Type.String(),
          subjectName: Type.String(),
          level: Level,
          evidenceCount: Type.Integer(),
          adjustment: Nullable(Type.Object({ justification: Type.String(), adjustedAt: DateTime }, closed)),
        },
        closed,
      ),
    ),
    subjects: Type.Array(
      Type.Object(
        {
          subjectId: Type.String(),
          name: Type.String(),
          average: Nullable(Type.Number()),
          grades: Type.Array(
            Type.Object(
              { attemptId: Type.String(), title: Type.String(), grade: Type.Number(), publishedAt: DateTime },
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

export const AdjustLevelRequest = Type.Object(
  {
    level: Type.Union([
      Type.Literal("not_acquired"),
      Type.Literal("in_progress"),
      Type.Literal("acquired"),
      Type.Literal("exceeded"),
    ]),
    justification: Type.String({ minLength: 1, maxLength: 500 }),
  },
  closed,
);

const LevelCounts = Type.Object(
  {
    not_assessed: Type.Integer(),
    not_acquired: Type.Integer(),
    in_progress: Type.Integer(),
    acquired: Type.Integer(),
    exceeded: Type.Integer(),
  },
  closed,
);

/** Synthèse du TUTEUR seulement (par élève et par groupe). */
export const ProgressOverviewResponse = Type.Object(
  {
    learners: Type.Array(
      Type.Object(
        {
          learnerId: Type.String(),
          xp: Type.Integer(),
          level: Type.Integer(),
          streak: Streak,
          levelCounts: LevelCounts,
          averages: Type.Array(
            Type.Object(
              { subjectId: Type.String(), name: Type.String(), average: Nullable(Type.Number()) },
              closed,
            ),
          ),
        },
        closed,
      ),
    ),
    groups: Type.Array(
      Type.Object(
        {
          groupId: Type.String(),
          name: Type.String(),
          learnerIds: Type.Array(Type.String()),
          levelCounts: LevelCounts,
        },
        closed,
      ),
    ),
  },
  closed,
);
