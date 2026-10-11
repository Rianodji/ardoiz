import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

/**
 * Document d'erreur RFC 9457 renvoyé par l'API. Le `code` est stable et sert à l'interface
 * pour choisir le message affiché ; aucun détail technique n'y figure jamais (R18, ADR-0010).
 */
export const ProblemDetails = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    code: Type.String({ pattern: "^[a-z0-9-]+(\\.[a-z0-9-]+)*$", maxLength: 100 }),
    requestId: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
);
export type ProblemDetails = Static<typeof ProblemDetails>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return Check(ProblemDetails, value);
}
