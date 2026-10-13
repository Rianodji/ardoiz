import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearnerDashboard, UpcomingAssignments } from "../src/components/ProgressViews";
import { GuardianSuggestions } from "../src/pages/SuggestionPages";
import { json, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const progress = {
  learnerId: "lrn_1",
  xp: 130,
  level: 1,
  currentLevelXp: 100,
  nextLevelXp: 300,
  streak: { current: 2, best: 3, paused: true },
  badges: [{ badge: "first-step", awardedAt: "2026-10-05T08:00:00.000Z" }],
  competencies: [
    {
      competencyId: "cmp_1",
      code: "M6-NC-03",
      label: "Convertir des unités de longueur",
      subjectName: "Mathématiques",
      level: "in_progress",
      evidenceCount: 3,
      adjustment: { justification: "Revu en séance <b>ensemble</b>", adjustedAt: "2026-10-06T08:00:00.000Z" },
    },
  ],
  subjects: [
    {
      subjectId: "sbj_1",
      name: "Mathématiques",
      average: 13.5,
      grades: [
        { attemptId: "att_1", title: "Arithmétique 1", grade: 12, publishedAt: "2026-10-01T08:00:00.000Z" },
        { attemptId: "att_2", title: "Arithmétique 2", grade: 15, publishedAt: "2026-10-08T08:00:00.000Z" },
      ],
    },
  ],
};

describe("Tableau de bord d'un élève (L6, R17)", () => {
  it("points, niveau, série en pause, badge, compétence ajustée et notes de l'élève, sans classement", async () => {
    stubServer((url) => (url === "/api/learners/lrn_1/progress" ? json(200, progress) : undefined));
    renderWith(<LearnerDashboard learnerId="lrn_1" you={false} />);
    expect(await screen.findByText("Niveau 1")).toBeTruthy();
    expect(screen.getByText(/170 points avant le niveau 2/)).toBeTruthy();
    expect(screen.getByText(/semaine en pause, la série continue/)).toBeTruthy();
    expect(screen.getByText(/Premier pas/)).toBeTruthy();
    // La justification du tuteur est du texte : la balise reste visible, rien n'est interprété (R4).
    expect(screen.getByText(/Revu en séance <b>ensemble<\/b>/)).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    // Graphique SVG construit par React : un point par note, et le tableau des copies corrigées.
    const chart = screen.getByRole("img", { name: "Notes de Mathématiques" });
    expect(chart.querySelectorAll("circle")).toHaveLength(2);
    expect(screen.getByText(/moyenne : 13,5 \/ 20/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Arithmétique 2" }).getAttribute("href")).toBe("/copie/att_2");
    expect(document.body.textContent).not.toMatch(/classement|rang|moyenne du groupe/i);
  });

  it("une réponse avec un champ en trop (un classement, par exemple) est rejetée, pas affichée (R17)", async () => {
    stubServer((url) =>
      url === "/api/learners/lrn_1/progress" ? json(200, { ...progress, rank: 1 }) : undefined,
    );
    renderWith(<LearnerDashboard learnerId="lrn_1" you />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Niveau 1")).toBeNull();
  });

  it("épreuves à venir et en retard d'un enfant", async () => {
    const assignment = (id: string, title: string, dueAt: string, state: string) => ({
      assignmentId: id,
      title,
      opensAt: "2026-10-01T08:00:00.000Z",
      dueAt,
      lateAllowed: false,
      attemptsLeft: 1,
      state,
      currentAttemptId: null,
      grade: null,
    });
    stubServer((url) =>
      url === "/api/learners/lrn_1/assignments"
        ? json(200, {
            assignments: [
              assignment("asg_1", "Fractions", "2026-10-20T08:00:00.000Z", "open"),
              assignment("asg_2", "Unités", "2026-10-02T08:00:00.000Z", "closed"),
              assignment("asg_3", "Déjà rendue", "2026-10-02T08:00:00.000Z", "submitted"),
            ],
          })
        : undefined,
    );
    renderWith(<UpcomingAssignments learnerId="lrn_1" now={Date.parse("2026-10-13T08:00:00Z")} />);
    expect(await screen.findByText(/Fractions — à rendre le/)).toBeTruthy();
    expect(screen.getByText(/Unités — attendue le .* \(non rendue\)/)).toBeTruthy();
    expect(screen.queryByText(/Déjà rendue/)).toBeNull();
  });
});

describe("Suggestions du parent (R4, R15)", () => {
  it("le texte reste du texte ; l'envoi part en texte brut avec son thème ; le statut et la réponse sont visibles", async () => {
    const calls = stubServer((url, init) => {
      if (url === "/api/suggestions" && init?.method === "POST") return json(201, { id: "sug_2" });
      if (url === "/api/suggestions")
        return json(200, {
          suggestions: [
            {
              id: "sug_1",
              guardianId: "gdn_1",
              category: "sessions",
              body: '<img src=x onerror="alert(1)">\nDeuxième ligne',
              createdAt: "2026-10-10T08:00:00.000Z",
              status: "done",
              reply: "C'est noté.",
              updatedAt: "2026-10-11T08:00:00.000Z",
            },
          ],
        });
      return undefined;
    });
    renderWith(<GuardianSuggestions />);
    const item = await screen.findByText(/<img src=x onerror="alert\(1\)">/);
    expect(document.querySelector("img")).toBeNull();
    expect(within(item.closest("li") ?? document.body).getByText(/Traitée/)).toBeTruthy();
    expect(screen.getByText(/C'est noté\./)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Thème"), { target: { value: "assessments" } });
    fireEvent.change(screen.getByLabelText(/Ta suggestion/), { target: { value: "Plus de QCM ?" } });
    expect(screen.getByText("13 / 2000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText(/Suggestion envoyée/)).toBeTruthy();
    const post = calls.find((call) => call.init?.method === "POST");
    const body = post?.init?.body;
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({
      category: "assessments",
      body: "Plus de QCM ?",
    });
  });
});
