import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnerProgress } from "../src/api/progress";
import { CompetencyList, GradeChart, ProgressSummary } from "../src/components/ProgressViews";
import { ChildAssignments } from "../src/pages/FamilyPage";
import { GuardianSuggestionsPage } from "../src/pages/SuggestionPages";
import { TutorProgressPage } from "../src/pages/TutorProgressPage";
import { json, renderAt, stubServer } from "./support";

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

const progress: LearnerProgress = {
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
  it("vue adulte : points, niveau, série en pause, badge, compétence ajustée et notes, sans classement", () => {
    const [subject] = progress.subjects;
    if (subject === undefined) throw new Error("matière absente");
    renderWith(
      <>
        <ProgressSummary progress={progress} />
        <CompetencyList progress={progress} />
        <GradeChart subject={subject} />
      </>,
    );
    expect(screen.getByText("Niveau 1")).toBeTruthy();
    expect(screen.getByText(/170 points avant le niveau 2/)).toBeTruthy();
    expect(screen.getByText(/semaine en pause, la série continue/)).toBeTruthy();
    expect(screen.getByText(/Premier pas/)).toBeTruthy();
    // La justification du tuteur est du texte : la balise reste visible, rien n'est interprété (R4).
    expect(screen.getByText(/Revu en séance <b>ensemble<\/b>/)).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    // Graphique SVG construit par React : un point par note, puis le tableau accessible des copies corrigées.
    const chart = screen.getByRole("img", { name: "Notes de Mathématiques" });
    expect(chart.querySelectorAll("circle")).toHaveLength(2);
    expect(screen.getByText(/moyenne : 13,5 \/ 20/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voir la copie : Arithmétique 2" }).getAttribute("href")).toBe(
      "/copie/att_2",
    );
    expect(screen.getByRole("region", { name: /Notes de Mathématiques, en tableau/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/classement|rang|moyenne du groupe/i);
  });

  it("vue de l'élève : les mots de l'enfant pour les niveaux, les badges obtenus et à gagner (charte §6)", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "learner", id: "lrn_1", name: "Lina", mfaEnrolled: false });
      if (url === "/api/learners/lrn_1/progress") return json(200, progress);
      return undefined;
    });
    renderAt("/eleve/progres");
    expect(await screen.findByText("En bonne voie")).toBeTruthy();
    expect(screen.queryByText("En cours d'acquisition")).toBeNull();
    expect(screen.getByText("Gagné le lundi 5 octobre")).toBeTruthy();
    expect(screen.getByText("Acquérir 5 compétences de géométrie")).toBeTruthy();
    expect(screen.getByText(/Ta meilleure série : 3 semaines/)).toBeTruthy();
    expect(screen.getByText(/Cette semaine est en pause : ta série continue/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/classement|rang|moyenne du groupe/i);
  });

  it("une réponse avec un champ en trop (un classement, par exemple) est rejetée, pas affichée (R17)", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "learner", id: "lrn_1", name: "Lina", mfaEnrolled: false });
      if (url === "/api/learners/lrn_1/progress") return json(200, { ...progress, rank: 1 });
      return undefined;
    });
    renderAt("/eleve/progres");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Niveau 1")).toBeNull();
  });

  it("devoirs à venir et en retard d'un enfant, vus par le parent", () => {
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
    renderWith(
      <ChildAssignments
        assignments={[
          assignment("asg_1", "Fractions", "2026-10-20T08:00:00.000Z", "open"),
          assignment("asg_2", "Unités", "2026-10-02T08:00:00.000Z", "closed"),
          assignment("asg_3", "Déjà rendue", "2026-10-02T08:00:00.000Z", "submitted"),
        ]}
        now={Date.parse("2026-10-13T08:00:00Z")}
      />,
    );
    expect(screen.getByText("Fractions").closest("li")?.textContent).toMatch(
      /à rendre le mardi 20 octobre à 10 h/,
    );
    expect(screen.getByText("Unités").closest("li")?.textContent).toMatch(/non rendu/);
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
    renderWith(<GuardianSuggestionsPage />);
    const item = await screen.findByText(/<img src=x onerror="alert\(1\)">/);
    expect(document.querySelector("img")).toBeNull();
    expect(within(item.closest("li") ?? document.body).getByText(/Traitée/)).toBeTruthy();
    expect(screen.getByText(/C'est noté\./)).toBeTruthy();

    // Le sujet se choisit par des boutons (radios) ; un compteur suit le message (maquette Parent-Suggestion).
    fireEvent.click(screen.getByLabelText("Les devoirs"));
    fireEvent.change(screen.getByLabelText("Votre message"), { target: { value: "Plus de QCM ?" } });
    expect(screen.getByText(/^13 \/ 2\s000$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer au tuteur" }));
    expect(await screen.findByText(/Message envoyé/)).toBeTruthy();
    const post = calls.find((call) => call.init?.method === "POST");
    const body = post?.init?.body;
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({
      category: "assessments",
      body: "Plus de QCM ?",
    });
  });
});

describe("Ajustement d'un niveau par le tuteur (verdict L6 S-4)", () => {
  it("le formulaire dit que la justification est visible par l'élève et ses parents", async () => {
    stubServer((url) => {
      if (url === "/api/progress/overview")
        return json(200, {
          learners: [
            {
              learnerId: "lrn_1",
              xp: 130,
              level: 1,
              streak: { current: 2, best: 3, paused: false },
              levelCounts: { not_assessed: 0, not_acquired: 0, in_progress: 1, acquired: 0, exceeded: 0 },
              averages: [],
            },
          ],
          groups: [],
        });
      if (url === "/api/families") return json(200, { guardians: [], learners: [] });
      if (url === "/api/learners/lrn_1/progress") return json(200, progress);
      return undefined;
    });
    renderWith(<TutorProgressPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Voir et ajuster/ }));
    const justification = await screen.findByLabelText(/Justification/);
    expect(justification.getAttribute("aria-describedby")).toBeTruthy();
    const hint = document.getElementById(justification.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("Visible par l'élève et ses parents.");
  });
});
