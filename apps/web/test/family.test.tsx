import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const learner = (status: "active" | "disabled", scheduledDeletionAt: string | null) => ({
  id: "lrn_1",
  firstName: "Lina",
  username: "lina",
  schoolLevel: "5e",
  status,
  scheduledDeletionAt,
  guardians: [{ guardianshipId: "gsh_1", guardianId: "gdn_1", displayName: "Awa" }],
});

function serve(child: ReturnType<typeof learner>) {
  stubServer((url) => {
    if (url === "/api/me")
      return json(200, { kind: "guardian", id: "gdn_1", name: "Awa", mfaEnrolled: false });
    if (url === "/api/learners") return json(200, { learners: [child] });
    // Le reste de l'espace famille (agenda, progression…) n'intéresse pas ce test.
    return problem(404, "application.not-found");
  });
}

describe("Retrait du consentement, vu par le parent (verdict L7, S-1)", () => {
  it("après le retrait : la date de suppression et comment l'annuler", async () => {
    serve(learner("disabled", "2026-11-12T08:00:00.000Z"));
    renderAt("/famille");
    expect(
      await screen.findByText(
        /Ses données seront supprimées le 12 novembre 2026\. Pour annuler, contactez le tuteur avant cette date\./,
      ),
    ).toBeTruthy();
  });

  it("sans retrait : aucun message de suppression", async () => {
    serve(learner("active", null));
    renderAt("/famille");
    expect(await screen.findByRole("heading", { name: "Suivi de Lina" })).toBeTruthy();
    expect(screen.queryByText(/seront supprimées/)).toBeNull();
  });
});
