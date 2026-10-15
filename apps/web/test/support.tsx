import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "../src/router";

export type Responder = (url: string, init: RequestInit | undefined) => Response | undefined;

export const json = (status: number, body: unknown, problem = false) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": problem ? "application/problem+json" : "application/json" },
  });

export const problem = (status: number, code: string) =>
  json(status, { type: "about:blank", title: "Erreur", status, code, requestId: "r" }, true);

/**
 * Serveur factice pour les tests d'interface : chaque appel `fetch` reçoit une vraie `Response`
 * construite par le test. Un appel non prévu échoue bruyamment.
 */
export function stubServer(responder: Responder): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const response = responder(url, init);
    if (response === undefined) return Promise.reject(new Error(`Appel non prévu : ${url}`));
    return Promise.resolve(response);
  });
  return calls;
}

export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/**
 * Une seule page, importée par le test, hors de la mise en page et de ses routes chargées à la demande
 * (verdict L8, S-12) : le module est chargé avant le test, et rien n'est attendu pendant qu'un
 * `import()` se résout sur une machine chargée. `route` est le motif de la page (« tuteur/corrections/:id »).
 */
export function renderPage(page: ReactElement, path: string, route = path) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: route, element: page }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
