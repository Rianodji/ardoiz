import { describe, expect, it } from "vitest";
import { AttemptRefusedError, DraftTooFrequentError } from "../../src/assessment/domain/errors.js";
import {
  autoGrade,
  gradeOutOf20,
  isMcqCorrect,
  isNumericCorrect,
} from "../../src/assessment/domain/grading.js";
import { parseSpec, type Question } from "../../src/assessment/domain/questions.js";
import { Rational } from "../../src/assessment/domain/Rational.js";
import { convert, unitsOf } from "../../src/assessment/domain/units.js";
import { assertCanStart, assertCanWork, assertDraftSaveAllowed } from "../../src/assessment/domain/window.js";

const dec = (raw: string): Rational => {
  const value = Rational.parseDecimal(raw);
  if (value === null) throw new Error(raw);
  return value;
};
const same = (a: Rational | null, b: string) => a !== null && a.compare(dec(b)) === 0;

describe("Conversions d'unités (big picture §8, critère L3)", () => {
  it.each([
    ["1", "km", "mm", "1000000"],
    ["2500000", "mm", "km", "2.5"],
    ["3", "t", "g", "3000000"],
    ["450", "g", "t", "0.00045"],
    ["250", "mL", "L", "0.25"],
    ["1.5", "L", "mL", "1500"],
    ["1", "m²", "cm²", "10000"],
    ["35000", "cm²", "m²", "3.5"],
    ["1000", "cm³", "L", "1"],
    ["2", "L", "cm³", "2000"],
    ["1", "dm³", "L", "1"],
    ["90", "min", "h", "1.5"],
    ["2.25", "h", "min", "135"],
  ])("%s %s = … %s (%s)", (value, from, to, expected) => {
    expect(same(convert(dec(value), from, to), expected)).toBe(true);
  });

  it("refuse de convertir entre deux grandeurs différentes", () => {
    expect(convert(dec("1"), "kg", "L")).toBeNull();
    expect(convert(dec("1"), "m", "m²")).toBeNull();
    expect(convert(dec("1"), "m", "pied")).toBeNull();
  });

  it("calcule exactement : 0,1 + 0,2 = 0,3", () => {
    expect(dec("0,1").add(dec("0.2")).compare(dec("0.3"))).toBe(0);
  });

  it("propose à l'élève les unités de la grandeur, capacités et volumes ensemble", () => {
    expect(unitsOf("length")).toEqual(["mm", "cm", "dm", "m", "dam", "hm", "km"]);
    expect(unitsOf("capacity")).toEqual(expect.arrayContaining(["mL", "L", "cm³", "dm³"]) as string[]);
  });
});

describe("Réponse numérique (big picture §8, R5)", () => {
  const spec = { expected: "12.5", tolerance: "0.1", unit: "cm", unitMode: "free" as const };

  it("accepte une réponse à la tolérance près, bornes comprises", () => {
    expect(isNumericCorrect(spec, { value: "12,5", unit: "cm" })).toBe(true);
    expect(isNumericCorrect(spec, { value: "12.6", unit: "cm" })).toBe(true);
    expect(isNumericCorrect(spec, { value: "12.4", unit: "cm" })).toBe(true);
    expect(isNumericCorrect(spec, { value: "12.61", unit: "cm" })).toBe(false);
  });

  it("unité libre : une réponse équivalente dans une autre unité est convertie", () => {
    expect(isNumericCorrect(spec, { value: "125", unit: "mm" })).toBe(true);
    expect(isNumericCorrect(spec, { value: "0,125", unit: "m" })).toBe(true);
    expect(isNumericCorrect(spec, { value: "125", unit: "g" })).toBe(false);
  });

  it("unité imposée : une réponse équivalente dans une autre unité est fausse (exercice de conversion)", () => {
    const imposed = { ...spec, unitMode: "imposed" as const };
    expect(isNumericCorrect(imposed, { value: "12.5", unit: "cm" })).toBe(true);
    expect(isNumericCorrect(imposed, { value: "125", unit: "mm" })).toBe(false);
  });

  it("une valeur illisible est fausse", () => {
    expect(isNumericCorrect(spec, { value: "douze", unit: "cm" })).toBe(false);
    expect(isNumericCorrect(spec, { value: "1e3", unit: "cm" })).toBe(false);
  });
});

describe("QCM et note de la copie (big picture §8)", () => {
  it("QCM : toutes les bonnes options et elles seules (tout ou rien, Q15)", () => {
    expect(isMcqCorrect(["o2"], ["o2"])).toBe(true);
    expect(isMcqCorrect(["o1", "o3"], ["o3", "o1"])).toBe(true);
    expect(isMcqCorrect(["o1", "o3"], ["o1"])).toBe(false);
    expect(isMcqCorrect(["o1"], ["o1", "o2"])).toBe(false);
  });

  it("note sur 20 arrondie au demi-point ; pas de note tant qu'une question attend le tuteur", () => {
    expect(gradeOutOf20([{ earned: 2, points: 3 }])).toBe(13.5); // 13,33 → 13,5
    expect(gradeOutOf20([{ earned: 7, points: 9 }])).toBe(15.5); // 15,56 → 15,5
    expect(gradeOutOf20([{ earned: 1, points: 8 }])).toBe(2.5); // 2,5 exactement
    expect(gradeOutOf20([{ earned: 13, points: 16 }])).toBe(16.5); // 16,25 → 16,5 (moitié de demi : vers le haut)
    expect(
      gradeOutOf20([
        { earned: 1, points: 1 },
        { earned: null, points: 2 },
      ]),
    ).toBeNull();
  });

  it("corrige automatiquement QCM et numérique ; la réponse courte attend le tuteur", () => {
    const question = (spec: Question["spec"]): Question => ({
      id: "qst_x" as never,
      position: 0,
      prompt: "?",
      points: 2,
      competencyIds: [],
      explanation: null,
      spec,
    });
    const mcq = question(
      parseSpec({ kind: "mcq", options: [{ text: "11" }, { text: "12" }], correctOptions: [1] }),
    );
    expect(autoGrade(mcq, { kind: "mcq", optionIds: ["o2"] })).toBe(2);
    expect(autoGrade(mcq, undefined)).toBe(0);
    expect(
      autoGrade(question({ kind: "short_text", modelAnswer: null }), { kind: "short_text", text: "x" }),
    ).toBeNull();
  });
});

describe("Fenêtre de passage, selon l'horloge du serveur (R5, M6)", () => {
  const opensAt = new Date("2026-10-12T07:00:00Z");
  const dueAt = new Date("2026-10-16T16:00:00Z");
  const window = { opensAt, dueAt, maxAttempts: 2, lateAllowed: false };
  const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);

  it("refusée à l'ouverture − 1 s, acceptée à l'ouverture + 0 s (R5)", () => {
    expect(() => {
      assertCanStart(window, at(opensAt, -1), 0);
    }).toThrow(expect.objectContaining({ code: "assessment.not-yet-open" }) as Error);
    expect(() => {
      assertCanStart(window, at(opensAt, 0), 0);
    }).not.toThrow();
  });

  it("acceptée à l'échéance − 1 s, refusée à l'échéance + 0 s (R5)", () => {
    expect(() => {
      assertCanStart(window, at(dueAt, -1), 0);
    }).not.toThrow();
    expect(() => {
      assertCanStart(window, at(dueAt, 0), 0);
    }).toThrow(expect.objectContaining({ code: "assessment.closed" }) as Error);
    expect(() => assertCanWork(window, at(dueAt, 0))).toThrow(AttemptRefusedError);
  });

  it("la dernière tentative est permise, la suivante non (R5)", () => {
    expect(() => {
      assertCanStart(window, at(opensAt, 10), 1);
    }).not.toThrow();
    expect(() => {
      assertCanStart(window, at(opensAt, 10), 2);
    }).toThrow(expect.objectContaining({ code: "assessment.no-attempts-left" }) as Error);
  });

  it("retard autorisé : rendu possible après l'échéance, marqué en retard (H7)", () => {
    expect(assertCanWork({ ...window, lateAllowed: true }, at(dueAt, 3600))).toEqual({ late: true });
    expect(assertCanWork(window, at(dueAt, -1))).toEqual({ late: false });
  });

  it("une sauvegarde au plus toutes les 5 s par tentative (R15)", () => {
    expect(() => {
      assertDraftSaveAllowed(at(opensAt, 0), at(opensAt, 4));
    }).toThrow(DraftTooFrequentError);
    expect(() => {
      assertDraftSaveAllowed(at(opensAt, 0), at(opensAt, 5));
    }).not.toThrow();
  });
});
