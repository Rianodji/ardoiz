import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignmentPreview } from "../src/pages/assignmentPreview";
import { longDateTime } from "../src/ui/format";
import { json, renderAt, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = Date.parse("2026-10-15T08:00:00.000Z");

describe("Ce que l'élève verra d'une attribution (verdict L8, S-5)", () => {
  it("écrit l'échéance avec le formateur commun, en heure de Paris", () => {
    expect(assignmentPreview(null, new Date("2026-10-16T16:00:00.000Z"), NOW)).toBe(
      "L'élève verra : « À rendre avant vendredi 16 octobre à\u00a018\u00a0h ». Le corrigé lui sera montré après cette date.",
    );
  });

  it("une ouverture à venir ajoute « S'ouvre le … » ; une ouverture passée ne change rien", () => {
    const due = new Date("2026-10-20T16:00:00.000Z");
    expect(assignmentPreview(new Date("2026-10-17T08:00:00.000Z"), due, NOW)).toBe(
      "L'élève verra : « S'ouvre le samedi 17 octobre à\u00a010\u00a0h », puis « À rendre avant mardi 20 octobre à\u00a018\u00a0h ». Le corrigé lui sera montré après cette date.",
    );
    expect(assignmentPreview(new Date("2026-10-14T08:00:00.000Z"), due, NOW)).not.toContain("S'ouvre");
  });

  it("rien tant que l'échéance n'est pas une date valide", () => {
    expect(assignmentPreview(null, null, NOW)).toBeNull();
    expect(assignmentPreview(null, new Date(""), NOW)).toBeNull();
  });

  it("dans le formulaire, la phrase suit les dates saisies", async () => {
    stubServer((url) => {
      if (url === "/api/me")
        return json(200, { kind: "tutor", id: "tut_1", name: "Dicard", mfaEnrolled: true });
      if (url === "/api/assessments")
        return json(200, {
          assessments: [
            {
              id: "asm_1",
              subjectId: "sub_1",
              title: "Périmètre et aire",
              assigned: false,
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
            },
          ],
        });
      if (url === "/api/assignments") return json(200, { assignments: [] });
      if (url === "/api/programme") return json(200, { subjects: [], modules: [], lessons: [] });
      if (url === "/api/families") return json(200, { guardians: [], learners: [] });
      if (url === "/api/groups") return json(200, { groups: [] });
      return undefined;
    });
    renderAt("/tuteur/epreuves");
    fireEvent.click(await screen.findByRole("button", { name: "Attribuer : Périmètre et aire" }));
    expect(screen.queryByText(/L'élève verra/)).toBeNull();

    // Les champs `datetime-local` sont en heure de l'appareil : l'attendu se calcule de la même façon.
    const due = (value: string) => longDateTime(new Date(value));
    fireEvent.change(screen.getByLabelText("À rendre avant"), { target: { value: "2099-10-15T18:00" } });
    expect(screen.getByText(/L'élève verra/).textContent).toBe(
      `L'élève verra : « À rendre avant ${due("2099-10-15T18:00")} ». Le corrigé lui sera montré après cette date.`,
    );

    fireEvent.change(screen.getByLabelText("S'ouvre"), { target: { value: "later" } });
    fireEvent.change(screen.getByLabelText("Date d'ouverture"), { target: { value: "2099-10-13T09:30" } });
    expect(screen.getByText(/L'élève verra/).textContent).toBe(
      `L'élève verra : « S'ouvre le ${due("2099-10-13T09:30")} », puis « À rendre avant ${due("2099-10-15T18:00")} ». Le corrigé lui sera montré après cette date.`,
    );

    fireEvent.change(screen.getByLabelText("À rendre avant"), { target: { value: "2099-10-16T08:00" } });
    expect(screen.getByText(/L'élève verra/).textContent).toContain(
      `À rendre avant ${due("2099-10-16T08:00")}`,
    );
  });
});
