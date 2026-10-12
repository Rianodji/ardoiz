import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentForm } from "../src/components/ConsentForm";
import { tokenFromHash } from "../src/pages/InvitationPage";
import { json, stubServer } from "./support";

// Sous jsdom, import.meta.url n'est pas une URL file: ; on part du dossier du test.
const markdown = readFileSync(
  join(import.meta.dirname, "../../../docs/juridique/consentement-parental-v1.md"),
  "utf8",
);
const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderConsent(onSubmit: (consent: unknown) => void) {
  stubServer((url) =>
    url === "/api/legal/consentement"
      ? json(200, { document: "consentement", markdown, version: "consentement-v1", sha256 })
      : undefined,
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ConsentForm pending={false} onSubmit={onSubmit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Consentement parental (R16)", () => {
  it("la case n'est pas pré-cochée et le bouton reste inactif tant qu'elle ne l'est pas (R16)", async () => {
    renderConsent(() => undefined);
    const checkbox = await screen.findByRole("checkbox");
    const button = screen.getByRole("button", { name: "Je donne mon accord" });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(checkbox);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("envoie la version et l'empreinte du texte affiché (R16)", async () => {
    const submitted: unknown[] = [];
    renderConsent((consent) => submitted.push(consent));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Je donne mon accord" }));
    expect(submitted).toEqual([{ accepted: true, version: "consentement-v1", sha256 }]);
  });

  it("la case porte exactement la phrase du texte, avec le lien vers la politique de confidentialité", async () => {
    renderConsent(() => undefined);
    const checkbox = await screen.findByRole("checkbox", {
      name: /titulaire de l'autorité parentale.*je donne mon accord/i,
    });
    expect(checkbox).toBeDefined();
    expect(screen.getByRole("link", { name: "politique de confidentialité" }).getAttribute("href")).toBe(
      "/confidentialite",
    );
  });
});

describe("Jeton dans le fragment de l'URL (R21)", () => {
  it("lit le jeton après #jeton=, jamais dans la chaîne de requête", () => {
    expect(tokenFromHash("#jeton=abc_DEF-123")).toBe("abc_DEF-123");
    expect(tokenFromHash("")).toBe("");
  });
});
