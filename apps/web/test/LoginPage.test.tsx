import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const anonymous = (url: string) => (url === "/api/me" ? problem(401, "http.unauthenticated") : undefined);

describe("Page de connexion", () => {
  it("propose le mode élève par défaut, avec des champs étiquetés (ADR-0003)", async () => {
    stubServer(anonymous);
    renderAt("/connexion");
    expect(await screen.findByLabelText("Code de ton espace")).toBeDefined();
    expect(screen.getByLabelText("Ton pseudo")).toBeDefined();
    expect(screen.getByLabelText("Ton mot de passe")).toBeDefined();
    expect(screen.queryByLabelText("Adresse e-mail")).toBeNull();
    expect(screen.getByRole("button", { name: "Je suis élève" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("« Afficher » montre le mot de passe tapé, puis « Masquer » le cache (L8)", async () => {
    stubServer(anonymous);
    renderAt("/connexion");
    const field = await screen.findByLabelText("Ton mot de passe");
    expect(field.getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(field.getAttribute("type")).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Masquer le mot de passe" }));
    expect(field.getAttribute("type")).toBe("password");
  });

  it("bascule vers le mode adulte avec l'adresse e-mail", async () => {
    stubServer(anonymous);
    renderAt("/connexion");
    fireEvent.click(await screen.findByRole("button", { name: "Je suis un adulte" }));
    expect(screen.getByLabelText("Adresse e-mail")).toBeDefined();
  });

  it("affiche un message clair et unique en cas d'échec, sans détail (R8)", async () => {
    stubServer(
      (url) =>
        anonymous(url) ??
        (url === "/api/auth/login/learner" ? problem(401, "identity.invalid-credentials") : undefined),
    );
    renderAt("/connexion");
    fireEvent.change(await screen.findByLabelText("Code de ton espace"), { target: { value: "dicard" } });
    fireEvent.change(screen.getByLabelText("Ton pseudo"), { target: { value: "lina" } });
    fireEvent.change(screen.getByLabelText("Ton mot de passe"), { target: { value: "faux" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrer dans Ardoiz" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Identifiant ou mot de passe incorrect. Vérifie et réessaie.",
    );
  });

  it("envoie le tuteur sans TOTP vers l'activation de la double authentification (R7)", async () => {
    let loggedIn = false;
    stubServer((url) => {
      if (url === "/api/me") {
        return loggedIn
          ? json(200, { kind: "tutor", id: "tut_1", name: "Dicard", mfaEnrolled: false })
          : problem(401, "http.unauthenticated");
      }
      if (url === "/api/auth/login/adult") {
        loggedIn = true;
        return json(200, { status: "mfa-enrollment-required" });
      }
      return undefined;
    });
    const router = renderAt("/connexion");
    fireEvent.click(await screen.findByRole("button", { name: "Je suis un adulte" }));
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "tuteur@example.org" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "mot-de-passe-de-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrer dans Ardoiz" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/double-authentification/activer");
    });
  });

  it("affiche une page introuvable pour une adresse inconnue", async () => {
    stubServer(anonymous);
    renderAt("/nulle-part");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeDefined();
  });
});
