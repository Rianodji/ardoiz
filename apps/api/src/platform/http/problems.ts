import type { ProblemDetails } from "@ardoiz/contracts";
import { PROBLEM_CONTENT_TYPE } from "@ardoiz/contracts";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DomainError } from "../../shared-kernel/DomainError.js";

const TITLES: Readonly<Record<number, string>> = {
  400: "Requête invalide",
  401: "Authentification requise",
  403: "Action non autorisée",
  404: "Ressource introuvable",
  405: "Méthode non autorisée",
  409: "Conflit",
  413: "Requête trop volumineuse",
  415: "Type de contenu non pris en charge",
  422: "Règle métier non respectée",
  429: "Trop de requêtes",
  500: "Erreur interne",
  503: "Service momentanément indisponible",
};

/** Statut HTTP de chaque code d'erreur métier. Un code absent de la table produit un 422. */
const STATUS_BY_DOMAIN_CODE: Readonly<Record<string, number>> = {
  "application.not-found": 404,
  // Un identifiant mal formé ne peut désigner aucune ressource : même réponse qu'une ressource absente (R2).
  "shared.invalid-identifier": 404,
  "application.forbidden": 403,
};

/** Erreurs techniques de Fastify qui décrivent une requête invalide, et leur code stable. */
const CLIENT_ERROR_CODES: Readonly<Record<number, string>> = {
  400: "http.invalid-request",
  413: "http.payload-too-large",
  415: "http.unsupported-media-type",
};

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
): FastifyReply {
  const problem: ProblemDetails = {
    type: "about:blank",
    title: TITLES[status] ?? "Erreur",
    status,
    code,
    requestId: request.id,
  };
  return reply.code(status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && "statusCode" in error && typeof error.statusCode === "number";
}

/**
 * Gestionnaire d'erreurs global, en mode fermé (R18, ADR-0010). Le client reçoit un document
 * RFC 9457 avec un code stable et l'identifiant de la requête ; jamais de message technique,
 * de trace ni d'erreur SQL. Toute erreur non reconnue devient un 500 générique, journalisé en entier.
 */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler(async (error: unknown, request, reply) => {
    if (error instanceof DomainError) {
      const status = STATUS_BY_DOMAIN_CODE[error.code] ?? 422;
      request.log.info({ code: error.code, status }, "erreur métier");
      return sendProblem(request, reply, status, error.code);
    }

    if (isFastifyError(error)) {
      const code =
        error.validation === undefined ? CLIENT_ERROR_CODES[error.statusCode ?? 0] : "http.invalid-request";
      if (code !== undefined) {
        request.log.info({ code, status: error.statusCode }, "requête refusée");
        return sendProblem(request, reply, error.statusCode ?? 400, code);
      }
    }

    request.log.error({ err: error }, "erreur inattendue");
    return sendProblem(request, reply, 500, "internal-error");
  });
}
