import { isProblemDetails, PROBLEM_CONTENT_TYPE } from "@ardoiz/contracts";

/**
 * Erreur d'appel à l'API. `code` est le code stable du document RFC 9457 ;
 * l'interface choisit son message à partir de ce code, jamais à partir d'un texte du serveur.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(`Erreur ${status} (${code})`);
    this.name = "ApiError";
  }
}

export type ResponseGuard<T> = (value: unknown) => value is T;

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function readProblem(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith(PROBLEM_CONTENT_TYPE)) {
    const body: unknown = await response.json().catch(() => null);
    if (isProblemDetails(body)) return new ApiError(body.status, body.code, body.requestId);
  }
  return new ApiError(response.status, "http.unexpected");
}

/**
 * Appel à l'API de la même origine. Le cookie de session part automatiquement (same-origin) ;
 * aucun jeton n'est jamais stocké côté navigateur (ADR-0006). Toute réponse est vérifiée
 * par un garde de type : une réponse inattendue est une erreur, pas une donnée.
 */
export async function apiFetch<T>(
  path: string,
  guard: ResponseGuard<T>,
  options: RequestOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      redirect: "error",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    throw new ApiError(0, "network.unavailable");
  }

  if (!response.ok) throw await readProblem(response);
  const body: unknown = await response.json().catch(() => undefined);
  if (!guard(body)) throw new ApiError(response.status, "http.unexpected-response");
  return body;
}

/**
 * Envoi d'octets bruts (import d'image, R14) : le serveur reconnaît le type par signature et réencode.
 * Même traitement des erreurs que `apiFetch` : un code stable, jamais le texte du serveur.
 */
export async function uploadBytes<T>(url: string, file: Blob, isExpected: ResponseGuard<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", accept: "application/json" },
      credentials: "same-origin",
      body: file,
    });
  } catch {
    throw new ApiError(0, "network.unavailable");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code =
      typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
        ? body.code
        : "http.unexpected";
    throw new ApiError(response.status, code);
  }
  const body: unknown = await response.json();
  if (!isExpected(body)) throw new ApiError(response.status, "http.unexpected-response");
  return body;
}
