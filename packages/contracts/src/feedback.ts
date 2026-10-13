import { Type } from "typebox";

/** Contrats HTTP des suggestions (règle 5) : du texte brut, borné (R4, R15). */
const closed = { additionalProperties: false } as const;
const Category = Type.Union(
  ["lessons", "sessions", "assessments", "other"].map((value) => Type.Literal(value)),
);
const Status = Type.Union(["new", "read", "done"].map((value) => Type.Literal(value)));
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);

export const NewSuggestionRequest = Type.Object(
  { category: Category, body: Type.String({ minLength: 1, maxLength: 2000 }) },
  closed,
);
export const HandleSuggestionRequest = Type.Object(
  {
    status: Type.Union([Type.Literal("read"), Type.Literal("done")]),
    reply: Type.Optional(Type.String({ maxLength: 500 })),
  },
  closed,
);
export const SuggestionView = Type.Object(
  {
    id: Type.String(),
    guardianId: Type.String(),
    category: Category,
    body: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
    status: Status,
    reply: Nullable(Type.String()),
    updatedAt: Nullable(Type.String({ format: "date-time" })),
  },
  closed,
);
export const SuggestionsResponse = Type.Object({ suggestions: Type.Array(SuggestionView) }, closed);
