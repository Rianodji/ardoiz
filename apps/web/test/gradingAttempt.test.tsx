import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ATTEMPT = {
  attemptId: "att_1",
  assignmentId: "asg_1",
  learnerId: "lrn_1",
  title: "Périmètre et aire",
  status: "submitted",
  number: 1,
  late: false,
  submittedAt: "2026-10-15T07:30:00.000Z",
  answersSha256: "e55aefe5c0ffee00112233445566778899aabbccddeeff00112233445566778",
  grade: null,
  questions: [
    {
      id: "q_1",
      kind: "short_text",
      prompt: "Unité d'aire ?",
      points: 1,
      competencyIds: [],
      explanation: null,
      spec: { kind: "short_text", modelAnswer: null },
    },
  ],
  answers: { q_1: { kind: "short_text", text: "m²" } },
  annotations: {},
  results: [{ questionId: "q_1", earned: null, gradedBy: "pending", comment: null, gradedAt: null }],
  rectifications: [],
};

describe("Copie à corriger (verdict L8, S-6)", () => {
  it("n'affiche pas l'empreinte des réponses : elle reste dans l'API et le journal", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "tutor", id: "tut_1", name: "Dicard", mfaEnrolled: true });
      if (url === "/api/grading/attempts/att_1") return json(200, ATTEMPT);
      if (url === "/api/grading/attempts")
        return json(200, {
          attempts: [
            {
              attemptId: "att_1",
              assignmentId: "asg_1",
              learnerId: "lrn_1",
              title: "Périmètre et aire",
              status: "submitted",
              late: false,
              submittedAt: "2026-10-15T07:30:00.000Z",
              grade: null,
            },
          ],
        });
      if (url === "/api/families") return json(200, { guardians: [], learners: [] });
      if (url === "/api/suggestions") return json(200, { suggestions: [] });
      return undefined;
    });
    renderAt("/tuteur/corrections/att_1");
    expect(await screen.findByText(/Essai 1 · rendu à temps/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/empreinte/i);
    expect(document.body.textContent).not.toContain("e55aefe5");
  });
});
