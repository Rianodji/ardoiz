import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Tuteur connecté jusqu'au clic sur « Me déconnecter », puis plus personne (le serveur ferme la session). */
function serveTutorUntilLogout() {
  let connected = true;
  return stubServer((url, init) => {
    if (url === "/api/me")
      return connected
        ? json(200, { kind: "tutor", id: "tut_1", name: "Dicard", mfaEnrolled: true })
        : problem(401, "http.unauthenticated");
    if (url === "/api/auth/logout" && init?.method === "POST") {
      connected = false;
      return new Response(null, { status: 204 });
    }
    if (!connected) return problem(401, "http.unauthenticated");
    if (url === "/api/auth/sessions") return json(200, { sessions: [] });
    if (url === "/api/grading/attempts") return json(200, { attempts: [] });
    if (url === "/api/suggestions") return json(200, { suggestions: [] });
    return undefined;
  });
}

describe("Déconnexion (L8, correction 1)", () => {
  it("après « Me déconnecter », la page de connexion n'affiche plus rien du tuteur", async () => {
    const calls = serveTutorUntilLogout();
    const router = renderAt("/compte");
    const menu = await screen.findByRole("navigation", { name: "Menu du tuteur" });
    const meCallsBefore = calls.filter((call) => call.url === "/api/me").length;
    fireEvent.click(within(menu).getByRole("button", { name: "Me déconnecter" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/connexion");
    });
    expect(await screen.findByRole("heading", { name: "Se connecter" })).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Menu du tuteur" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Programme|Corrections|Journal d'audit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Me déconnecter" })).toBeNull();
    // La cause du défaut de la v1.0 : après `clear()`, l'observateur gardait l'ancien compte, et rien
    // ne redemandait /api/me. La déconnexion écrit désormais elle-même « personne n'est connecté ».
    expect(calls.filter((call) => call.url === "/api/me").length).toBe(meCallsBefore);
  });

  it("après la déconnexion, une page protégée renvoie vers la connexion", async () => {
    serveTutorUntilLogout();
    const router = renderAt("/compte");
    const menu = await screen.findByRole("navigation", { name: "Menu du tuteur" });
    fireEvent.click(within(menu).getByRole("button", { name: "Me déconnecter" }));
    await screen.findByRole("heading", { name: "Se connecter" });
    await router.navigate("/tuteur/journal");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/connexion");
    });
    expect(screen.queryByRole("heading", { name: "Journal d'audit" })).toBeNull();
  });
});
