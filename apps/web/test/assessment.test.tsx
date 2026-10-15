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
  answerKey: null,
  ...overrides,
});

describe("Copie de l'élève (R5)", () => {
  it("mode focus : une question à la fois, puis la copie rendue avec les identifiants opaques reçus", async () => {
    const calls = stubServer((url, init) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1") return json(200, attempt());
      if (url === "/api/attempts/att_1/submit" && init?.method === "POST")
        return json(200, attempt({ status: "submitted", submittedAt: "2026-10-12T08:00:00.000Z" }));
      return undefined;
    });
    renderAt("/copie/att_1");
    // Une seule question à l'écran ; les pastilles disent où on en est.
    expect(await screen.findByRole("heading", { name: /Combien font 3 × 4 \?/ })).toBeDefined();
    expect(screen.queryByText("Longueur ?")).toBeNull();
    expect(screen.getByRole("button", { name: "Question 1" }).getAttribute("aria-current")).toBe("step");
    // Pas de menu en mode focus : seulement l'en-tête réduit.
    expect(screen.queryByRole("navigation", { name: "Navigation principale" })).toBeNull();
    expect(screen.getByRole("button", { name: "Arrêter et reprendre plus tard" })).toBeDefined();
    fireEvent.click(screen.getByLabelText("12"));
    expect(screen.getByRole("button", { name: "Question 1, répondue" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Question suivante/ }));
    fireEvent.change(screen.getByLabelText("Ta réponse"), { target: { value: "12,5" } });
    fireEvent.change(screen.getByLabelText("Unité"), { target: { value: "cm" } });
    // Rendre est définitif (R6) : une confirmation d'abord, rien n'est envoyé avant.
    fireEvent.click(screen.getByRole("button", { name: "Rendre mon devoir" }));
    expect(calls.some((call) => call.url.endsWith("/submit"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Oui, rendre mon devoir" }));
    await screen.findByText(/Ton devoir est rendu\. Ton tuteur va le corriger/);
    const submit = calls.find((call) => call.url === "/api/attempts/att_1/submit");
    const body = submit?.init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({
      answers: {
        qst_1: { kind: "mcq", optionIds: ["x9"] },
        qst_2: { kind: "numeric", value: "12,5", unit: "cm" },
      },
    });
    expect(screen.queryByRole("button", { name: /Rendre mon devoir/ })).toBeNull();
  });

  it("avant de rendre, l'élève est prévenu des questions sans réponse", async () => {
    stubServer((url) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1") return json(200, attempt());
      return undefined;
    });
    renderAt("/copie/att_1");
    fireEvent.click(await screen.findByRole("button", { name: "Rendre mon devoir" }));
    expect(screen.getByText(/Attention : 2 questions n'ont pas encore de réponse\./)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Pas encore" }));
    expect(screen.getByRole("button", { name: "Rendre mon devoir" })).toBeDefined();
  });

  it("« Arrêter et reprendre plus tard » enregistre le brouillon puis ramène à mes devoirs", async () => {
    const calls = stubServer((url, init) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1") return json(200, attempt());
      if (url === "/api/attempts/att_1/answers" && init?.method === "PUT")
        return new Response(null, { status: 204 });
      if (url === "/api/my/assignments") return json(200, { assignments: [] });
      return undefined;
    });
    const router = renderAt("/copie/att_1");
    fireEvent.click(await screen.findByLabelText("12"));
    expect(screen.getByText("Pas encore enregistré…")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Arrêter et reprendre plus tard" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/eleve/devoirs");
    });
    const draft = calls.find((call) => call.url === "/api/attempts/att_1/answers");
    expect(JSON.parse(typeof draft?.init?.body === "string" ? draft.init.body : "null")).toEqual({
      answers: { qst_1: { kind: "mcq", optionIds: ["x9"] } },
    });
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

  const published = (answerKey: unknown) =>
    attempt({
      status: "published",
      submittedAt: "2026-10-12T08:00:00.000Z",
      answers: { qst_1: { kind: "mcq", optionIds: ["x9"] } },
      correction: {
        grade: 13.5,
        questions: [
          { questionId: "qst_1", earned: 2, comment: null, annotation: null },
          { questionId: "qst_2", earned: 0, comment: "Revois les conversions.", annotation: null },
        ],
      },
      answerKey,
    });

  it("publiée, corrigé pas encore révélé : la note et les points, et l'annonce du corrigé après la date limite (R5, R-1)", async () => {
    stubServer((url) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1") return json(200, published(null));
      return undefined;
    });
    renderAt("/copie/att_1");
    expect(await screen.findByLabelText("Note : 13,5 sur 20")).toBeDefined();
    expect(
      screen.getByText(/Le corrigé sera visible après la date limite, vendredi 16 octobre à 18 h/),
    ).toBeDefined();
    expect(screen.queryByText(/Réponse attendue/)).toBeNull();
    expect(screen.getByText(/Revois les conversions\./).textContent).toBe(
      "Le mot de ton tuteur : Revois les conversions.",
    );
    // Jamais de rouge ni d'échec : « Réussie » ou « À revoir » (charte §1).
    expect(screen.getByText("Réussie")).toBeDefined();
    expect(screen.getByText("À revoir")).toBeDefined();
    expect(screen.getByText(/tu as réussi 1 question sur 2/)).toBeDefined();
  });

  it("affiche le corrigé une fois révélé", async () => {
    stubServer((url) => {
      if (url === "/api/me") return me();
      if (url === "/api/attempts/att_1")
        return json(
          200,
          published({
            questions: [
              {
                questionId: "qst_1",
                explanation: "3 × 4 = 12.",
                expected: { kind: "mcq", correctOptionIds: ["x9"] },
              },
              {
                questionId: "qst_2",
                explanation: null,
                expected: { kind: "numeric", expected: "12.5", unit: "cm", unitMode: "free" },
              },
            ],
          }),
        );
      return undefined;
    });
    renderAt("/copie/att_1");
    const row = (await screen.findByText(/Réponse attendue : 12,5 cm/)).closest("li");
    expect(row?.textContent).toContain("0 / 1");
    expect(screen.getByText(/Réponse attendue : 12$/)).toBeDefined();
    expect(screen.getByText("3 × 4 = 12.")).toBeDefined();
    expect(screen.queryByText(/Le corrigé sera visible après la date limite/)).toBeNull();
  });
});
