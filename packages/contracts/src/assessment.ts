import { Type } from "typebox";

/**
 * Contrats HTTP du module assessment (règle 5). Les réponses destinées à l'élève (`Learner…`) ont des
 * schémas fermés SANS aucun champ de réponse attendue : même une fuite côté serveur serait retirée à
 * la sérialisation (R5, ADR-0007). Le corrigé n'y figure que dans `correction`, rempli après publication.
 */
const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 5, maxLength: 60 });
const Text = (max: number) => Type.String({ minLength: 1, maxLength: max });
const DateTime = Type.String({ format: "date-time" });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);
const Points = Type.Number({ minimum: 0, maximum: 100, multipleOf: 0.5 });
const Kind = Type.Union([Type.Literal("mcq"), Type.Literal("numeric"), Type.Literal("short_text")]);

export const NewAssessmentRequest = Type.Object({ subjectId: Id, title: Text(120) }, closed);

const QuestionBase = {
  prompt: Text(2000),
  points: Points,
  competencyIds: Type.Array(Id, { minItems: 1, maxItems: 10 }),
  explanation: Type.Optional(Type.String({ maxLength: 2000 })),
};
export const QuestionRequest = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("mcq"),
      ...QuestionBase,
      options: Type.Array(Type.Object({ text: Text(300) }, closed), { minItems: 2, maxItems: 8 }),
      correctOptions: Type.Array(Type.Integer({ minimum: 0, maximum: 7 }), { minItems: 1, maxItems: 8 }),
    },
    closed,
  ),
  Type.Object(
    {
      kind: Type.Literal("numeric"),
      ...QuestionBase,
      expected: Text(32),
      tolerance: Text(32),
      unit: Text(8),
      unitMode: Type.Union([Type.Literal("imposed"), Type.Literal("free")]),
    },
    closed,
  ),
  Type.Object(
    {
      kind: Type.Literal("short_text"),
      ...QuestionBase,
      modelAnswer: Type.Optional(Type.String({ maxLength: 1000 })),
    },
    closed,
  ),
]);
export const QuestionsRequest = Type.Object(
  { questions: Type.Array(QuestionRequest, { maxItems: 50 }) },
  closed,
);

export const AssignmentRequest = Type.Object(
  {
    assessmentId: Id,
    audience: Type.Object(
      { kind: Type.Union([Type.Literal("learner"), Type.Literal("group")]), id: Id },
      closed,
    ),
    opensAt: DateTime,
    dueAt: DateTime,
    maxAttempts: Type.Integer({ minimum: 1, maximum: 10 }),
    lateAllowed: Type.Boolean(),
    publication: Type.Union([Type.Literal("auto"), Type.Literal("manual")]),
  },
  closed,
);

export const LearnerAnswer = Type.Union([
  Type.Object(
    { kind: Type.Literal("mcq"), optionIds: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 }) },
    closed,
  ),
  Type.Object(
    {
      kind: Type.Literal("numeric"),
      value: Type.String({ maxLength: 32 }),
      unit: Type.String({ maxLength: 8 }),
    },
    closed,
  ),
  Type.Object({ kind: Type.Literal("short_text"), text: Type.String({ maxLength: 2000 }) }, closed),
]);
export const AnswersRequest = Type.Object(
  { answers: Type.Record(Type.String({ maxLength: 60 }), LearnerAnswer, { maxProperties: 50 }) },
  closed,
);
export const SubmitRequest = Type.Object(
  {
    answers: Type.Optional(Type.Record(Type.String({ maxLength: 60 }), LearnerAnswer, { maxProperties: 50 })),
  },
  closed,
);
export const GradeRequest = Type.Object(
  {
    grades: Type.Array(
      Type.Object(
        { questionId: Id, earned: Points, comment: Type.Optional(Type.String({ maxLength: 1000 })) },
        closed,
      ),
      {
        minItems: 1,
        maxItems: 50,
      },
    ),
  },
  closed,
);
export const RectificationRequest = Type.Object(
  { questionId: Id, earned: Points, reason: Text(500) },
  closed,
);

// --- Vues de l'élève : AUCUNE réponse attendue (R5) ------------------------------------------------
const LearnerQuestion = Type.Union([
  Type.Object(
    {
      id: Type.String(),
      kind: Type.Literal("mcq"),
      prompt: Type.String(),
      points: Type.Number(),
      options: Type.Array(Type.Object({ id: Type.String(), text: Type.String() }, closed)),
    },
    closed,
  ),
  Type.Object(
    {
      id: Type.String(),
      kind: Type.Literal("numeric"),
      prompt: Type.String(),
      points: Type.Number(),
      units: Type.Array(Type.String()),
    },
    closed,
  ),
  Type.Object(
    { id: Type.String(), kind: Type.Literal("short_text"), prompt: Type.String(), points: Type.Number() },
    closed,
  ),
]);
/** Publication : la note et les points obtenus, sans aucune réponse attendue (R5). */
const Correction = Type.Object(
  {
    grade: Type.Number(),
    questions: Type.Array(
      Type.Object(
        { questionId: Type.String(), earned: Type.Number(), comment: Nullable(Type.String()) },
        closed,
      ),
    ),
  },
  closed,
);
/** Révélation (verdict L3, R-1) : réponses attendues et explications, pour toute l'attribution à la fois. */
const AnswerKey = Type.Object(
  {
    questions: Type.Array(
      Type.Object(
        {
          questionId: Type.String(),
          explanation: Nullable(Type.String()),
          expected: Type.Union([
            Type.Object({ kind: Type.Literal("mcq"), correctOptionIds: Type.Array(Type.String()) }, closed),
            Type.Object(
              {
                kind: Type.Literal("numeric"),
                expected: Type.String(),
                unit: Type.String(),
                unitMode: Type.Union([Type.Literal("imposed"), Type.Literal("free")]),
              },
              closed,
            ),
            Type.Object({ kind: Type.Literal("short_text"), modelAnswer: Nullable(Type.String()) }, closed),
          ]),
        },
        closed,
      ),
    ),
  },
  closed,
);
const Status = Type.Union([
  Type.Literal("draft"),
  Type.Literal("submitted"),
  Type.Literal("graded"),
  Type.Literal("published"),
]);
export const LearnerAttemptResponse = Type.Object(
  {
    attemptId: Type.String(),
    assignmentId: Type.String(),
    title: Type.String(),
    status: Status,
    number: Type.Integer(),
    dueAt: DateTime,
    late: Type.Boolean(),
    submittedAt: Nullable(DateTime),
    questions: Type.Array(LearnerQuestion),
    answers: Type.Record(Type.String(), LearnerAnswer),
    correction: Nullable(Correction),
    answerKey: Nullable(AnswerKey),
  },
  closed,
);
export const LearnerAssignmentsResponse = Type.Object(
  {
    assignments: Type.Array(
      Type.Object(
        {
          assignmentId: Type.String(),
          title: Type.String(),
          opensAt: DateTime,
          dueAt: DateTime,
          lateAllowed: Type.Boolean(),
          attemptsLeft: Type.Integer(),
          state: Type.Union(
            ["upcoming", "open", "in_progress", "submitted", "published", "closed"].map((state) =>
              Type.Literal(state),
            ),
          ),
          currentAttemptId: Nullable(Type.String()),
          grade: Nullable(Type.Number()),
        },
        closed,
      ),
    ),
  },
  closed,
);
export const PublishedResultsResponse = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        {
          attemptId: Type.String(),
          title: Type.String(),
          grade: Nullable(Type.Number()),
          publishedAt: DateTime,
        },
        closed,
      ),
    ),
  },
  closed,
);

// --- Vues du tuteur ------------------------------------------------------------------------------
const AuthorSpec = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("mcq"),
      options: Type.Array(Type.Object({ id: Type.String(), text: Type.String() }, closed)),
      correctOptionIds: Type.Array(Type.String()),
    },
    closed,
  ),
  Type.Object(
    {
      kind: Type.Literal("numeric"),
      expected: Type.String(),
      tolerance: Type.String(),
      unit: Type.String(),
      unitMode: Type.Union([Type.Literal("imposed"), Type.Literal("free")]),
    },
    closed,
  ),
  Type.Object({ kind: Type.Literal("short_text"), modelAnswer: Nullable(Type.String()) }, closed),
]);
const AuthorQuestion = Type.Object(
  {
    id: Type.String(),
    kind: Kind,
    prompt: Type.String(),
    points: Type.Number(),
    competencyIds: Type.Array(Type.String()),
    explanation: Nullable(Type.String()),
    spec: AuthorSpec,
  },
  closed,
);
export const AuthorAssessmentResponse = Type.Object(
  {
    id: Type.String(),
    subjectId: Type.String(),
    title: Type.String(),
    assigned: Type.Boolean(),
    questions: Type.Array(AuthorQuestion),
  },
  closed,
);
export const AuthorAssessmentsResponse = Type.Object(
  { assessments: Type.Array(AuthorAssessmentResponse) },
  closed,
);
export const AssignmentsResponse = Type.Object(
  {
    assignments: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          assessmentId: Type.String(),
          opensAt: DateTime,
          dueAt: DateTime,
          maxAttempts: Type.Integer(),
          lateAllowed: Type.Boolean(),
          publication: Type.Union([Type.Literal("auto"), Type.Literal("manual")]),
          learnerIds: Type.Array(Type.String()),
          revealedAt: Nullable(DateTime),
        },
        closed,
      ),
    ),
  },
  closed,
);
export const GradingQueueResponse = Type.Object(
  {
    attempts: Type.Array(
      Type.Object(
        {
          attemptId: Type.String(),
          assignmentId: Type.String(),
          learnerId: Type.String(),
          title: Type.String(),
          status: Status,
          late: Type.Boolean(),
          submittedAt: Nullable(DateTime),
          grade: Nullable(Type.Number()),
        },
        closed,
      ),
    ),
  },
  closed,
);
const TutorAnswer = Type.Union([
  Type.Object({ kind: Type.Literal("mcq"), optionIds: Type.Array(Type.String()) }, closed),
  Type.Object({ kind: Type.Literal("numeric"), value: Type.String(), unit: Type.String() }, closed),
  Type.Object({ kind: Type.Literal("short_text"), text: Type.String() }, closed),
]);
export const TutorAttemptResponse = Type.Object(
  {
    attemptId: Type.String(),
    assignmentId: Type.String(),
    learnerId: Type.String(),
    title: Type.String(),
    status: Status,
    number: Type.Integer(),
    late: Type.Boolean(),
    submittedAt: Nullable(DateTime),
    answersSha256: Nullable(Type.String()),
    grade: Nullable(Type.Number()),
    questions: Type.Array(AuthorQuestion),
    answers: Type.Record(Type.String(), TutorAnswer),
    results: Type.Array(
      Type.Object(
        {
          questionId: Type.String(),
          earned: Nullable(Type.Number()),
          gradedBy: Type.Union([Type.Literal("auto"), Type.Literal("tutor"), Type.Literal("pending")]),
          comment: Nullable(Type.String()),
          gradedAt: Nullable(DateTime),
        },
        closed,
      ),
    ),
    rectifications: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          questionId: Type.String(),
          previousEarned: Type.Number(),
          newEarned: Type.Number(),
          previousGrade: Type.Number(),
          newGrade: Type.Number(),
          reason: Type.String(),
          rectifiedAt: DateTime,
          rectifiedBy: Type.String(),
        },
        closed,
      ),
    ),
  },
  closed,
);
