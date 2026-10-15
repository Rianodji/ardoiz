import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const assignment = (state: string) => ({
  assignmentId: "asg_1",
  title: "Périmètre et aire",
  opensAt: "2026-10-17T08:00:00.000Z",
  dueAt: "2026-10-20T16:00:00.000Z",
  lateAllowed: false,
  attemptsLeft: 1,
  state,
  currentAttemptId: null,
  grade: null,
});

describe("Date d'ouverture d'un devoir (L8, correction 2)", () => {
  it("dans la liste « Mes devoirs », la ligne répète l'ouverture et l'échéance", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "learner", id: "lrn_1", name: "Lina", mfaEnrolled: false });
      if (url === "/api/my/assignments") return json(200, { assignments: [assignment("upcoming")] });
      return undefined;
    });
    renderAt("/eleve/devoirs");
    expect(
      await screen.findByText(
        "S'ouvre le samedi 17 octobre à 10 h, à rendre avant le mardi 20 octobre à 18 h.",
      ),
    ).toBeDefined();
    // La pastille, avec son mot et son icône : « Bientôt : s'ouvre le … », en heure de Paris.
    expect(screen.getByText("Bientôt : s'ouvre le samedi 17 octobre à 10 h")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Commencer" })).toBeNull();
  });
});
