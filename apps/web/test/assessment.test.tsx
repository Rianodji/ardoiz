import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me = () => json(200, { kind: "learner", id: "lrn_1", name: "Lina", mfaEnrolled: false });
const attempt = (overrides: object = {}) => ({
  attemptId: "att_1",
  assignmentId: "asg_1",
  title: "Arithmétique 1",
  status: "draft",
  number: 1,
  dueAt: "2026-10-16T16:00:00.000Z",
  late: false,
  submittedAt: null,
  questions: [
    {
      id: "qst_1",
      kind: "mcq",
      prompt: "Combien font 3 × 4 ?",
      points: 2,
      options: [
        { id: "x9", text: "12" },
        { id: "k2", text: "7" },
      ],
    },
    { id: "qst_2", kind: "numeric", prompt: "Longueur ?", points: 1, units: ["mm", "cm", "m"] },
  ],
  answers: {},
  correction: null,
  ...overrides,
});

describe("Copie de l'élève (R5)", () => {
  it("affiche les questions et rend la copie avec les identifiants opaques reçus", async () => {
    vi.stubGlobal("confirm", () => true);
    const calls = stubServer((url, init) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1") return json(200, attempt());
      if (url === "/api/attempts/att_1/submit" && init?.method === "POST")
        return json(200, attempt({ status: "submitted", submittedAt: "2026-10-12T08:00:00.000Z" }));
      return undefined;
    });
    renderAt("/copie/att_1");
    fireEvent.click(await screen.findByLabelText("12"));
    fireEvent.change(screen.getByLabelText("Ta réponse"), { target: { value: "12,5" } });
    fireEvent.change(screen.getByLabelText("Unité"), { target: { value: "cm" } });
    fireEvent.click(screen.getByRole("button", { name: "Rendre ma copie" }));
    await screen.findByText("Copie rendue.");
    const submit = calls.find((call) => call.url === "/api/attempts/att_1/submit");
    const body = submit?.init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({
      answers: {
        qst_1: { kind: "mcq", optionIds: ["x9"] },
        qst_2: { kind: "numeric", value: "12,5", unit: "cm" },
      },
    });
    expect(screen.queryByRole("button", { name: "Rendre ma copie" })).toBeNull();
  });

  it("refuse d'afficher une réponse du serveur qui contiendrait une réponse attendue (schéma fermé, R5)", async () => {
    stubServer((url) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1") {
        const leaked = attempt();
        return json(200, { ...leaked, questions: [{ ...leaked.questions[0], correctOptionIds: ["x9"] }] });
      }
      return undefined;
    });
    renderAt("/copie/att_1");
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.queryByText("Combien font 3 × 4 ?")).toBeNull();
  });

  it("affiche la note et le corrigé une fois la correction publiée", async () => {
    stubServer((url) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1")
        return json(
          200,
          attempt({
            status: "published",
            submittedAt: "2026-10-12T08:00:00.000Z",
            answers: { qst_1: { kind: "mcq", optionIds: ["x9"] } },
            correction: {
              grade: 13.5,
              questions: [
                {
                  questionId: "qst_1",
                  earned: 2,
                  comment: null,
                  explanation: "3 × 4 = 12.",
                  correction: { kind: "mcq", correctOptionIds: ["x9"] },
                },
                {
                  questionId: "qst_2",
                  earned: 0,
                  comment: "Revois les conversions.",
                  explanation: null,
                  correction: { kind: "numeric", expected: "12.5", unit: "cm", unitMode: "free" },
                },
              ],
            },
          }),
        );
      return undefined;
    });
    renderAt("/copie/att_1");
    expect((await screen.findByText(/Note :/)).textContent).toBe("Note : 13,5 / 20");
    expect(screen.getByText(/Réponse attendue : 12,5 cm/)).toBeDefined();
    expect(screen.getByText("Commentaire du tuteur : Revois les conversions.")).toBeDefined();
  });
});
