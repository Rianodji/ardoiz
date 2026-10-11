import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../src/router";

const renderAt = (path: string) =>
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

afterEach(cleanup);

describe("Page de connexion (factice, L0)", () => {
  it("propose le mode élève par défaut, avec des champs étiquetés", () => {
    renderAt("/connexion");
    expect(screen.getByRole("heading", { name: "Se connecter" })).toBeDefined();
    expect(screen.getByLabelText("Code de ton espace")).toBeDefined();
    expect(screen.getByLabelText("Ton pseudo")).toBeDefined();
    expect(screen.getByLabelText("Mot de passe")).toBeDefined();
    expect(screen.queryByLabelText("Adresse e-mail")).toBeNull();
  });

  it("bascule vers le mode adulte avec l'adresse e-mail", () => {
    renderAt("/connexion");
    fireEvent.click(screen.getByRole("button", { name: "Je suis parent ou tuteur" }));
    expect(screen.getByLabelText("Adresse e-mail")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Je suis parent ou tuteur" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("annonce que la connexion n'est pas encore ouverte, sans rien envoyer", () => {
    renderAt("/connexion");
    fireEvent.click(screen.getByRole("button", { name: "Me connecter" }));
    expect(screen.getByRole("status").textContent).toContain("pas encore ouverte");
  });

  it("affiche une page introuvable pour une adresse inconnue", () => {
    renderAt("/nulle-part");
    expect(screen.getByRole("heading", { name: "Page introuvable" })).toBeDefined();
  });
});
