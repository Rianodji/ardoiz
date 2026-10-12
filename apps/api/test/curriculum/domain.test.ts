import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFERENTIAL_FILE } from "../../src/app/paths.js";
import { learnerCanAccessLesson, type ActiveUnlock } from "../../src/curriculum/domain/access.js";
import { nextCompetencyCode, parseReferential } from "../../src/curriculum/domain/referential.js";
import { CompetencyLabel, Title } from "../../src/curriculum/domain/values.js";
import { UuidV7IdGenerator } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { FixedClock } from "../support/clock.js";

const ids = new UuidV7IdGenerator(new FixedClock(new Date("2026-10-12T08:00:00Z")));

describe("Accès d'un élève à un cours (R3, M5)", () => {
  const lina = ids.next("LearnerId");
  const noe = ids.next("LearnerId");
  const group = ids.next("GroupId");
  const moduleId = ids.next("ModuleId");
  const lessonId = ids.next("LessonId");
  const lesson = { lessonId, moduleId, published: true };
  const unlockLessonFor = (audience: ActiveUnlock["audience"]): ActiveUnlock => ({
    target: { kind: "lesson", id: lessonId },
    audience,
  });

  it("refuse par défaut : publié mais jamais déverrouillé (R3)", () => {
    expect(learnerCanAccessLesson(lesson, lina, new Set(), [])).toBe(false);
  });

  it("ouvre le cours aux membres d'un groupe déverrouillé, et à eux seuls (R3)", () => {
    const unlocks = [unlockLessonFor({ kind: "group", id: group })];
    expect(learnerCanAccessLesson(lesson, lina, new Set([group]), unlocks)).toBe(true);
    expect(learnerCanAccessLesson(lesson, noe, new Set(), unlocks)).toBe(false);
  });

  it("déverrouiller pour un élève n'ouvre le cours qu'à lui (R3)", () => {
    const unlocks = [unlockLessonFor({ kind: "learner", id: lina })];
    expect(learnerCanAccessLesson(lesson, lina, new Set(), unlocks)).toBe(true);
    expect(learnerCanAccessLesson(lesson, noe, new Set(), unlocks)).toBe(false);
  });

  it("déverrouiller le module ouvre ses cours publiés (R3)", () => {
    const unlocks: ActiveUnlock[] = [
      { target: { kind: "module", id: moduleId }, audience: { kind: "learner", id: lina } },
    ];
    expect(learnerCanAccessLesson(lesson, lina, new Set(), unlocks)).toBe(true);
    expect(
      learnerCanAccessLesson({ ...lesson, moduleId: ids.next("ModuleId") }, lina, new Set(), unlocks),
    ).toBe(false);
  });

  it("un brouillon reste invisible, même déverrouillé (R3)", () => {
    expect(
      learnerCanAccessLesson({ ...lesson, published: false }, lina, new Set(), [
        unlockLessonFor({ kind: "learner", id: lina }),
      ]),
    ).toBe(false);
  });
});

describe("Référentiel de compétences", () => {
  it("lit le référentiel validé par le tuteur : 2 matières, 4 domaines, 33 compétences aux codes stables", () => {
    const subjects = parseReferential(readFileSync(REFERENTIAL_FILE, "utf8"));
    expect(subjects.map((subject) => subject.name)).toEqual(["Mathématiques", "Initiation à l'informatique"]);
    const domains = subjects.flatMap((subject) => subject.domains);
    expect(domains.map((domain) => `${domain.prefix} ${domain.label}`)).toEqual([
      "NUM Nombres et calculs",
      "GEO Espace et géométrie",
      "MES Grandeurs et mesures",
      "INF Initiation à l'informatique",
    ]);
    const codes = domains.flatMap((domain) => domain.competencies.map((competency) => competency.code));
    expect(codes).toHaveLength(33);
    expect(new Set(codes).size).toBe(33);
    expect(domains[2]?.competencies[0]).toEqual({
      code: "MES-01",
      label: "Convertir des longueurs (mm, cm, dm, m, dam, hm, km)",
    });
  });

  it("numérote une nouvelle compétence après la plus grande, archivées comprises : un code n'est jamais réutilisé", () => {
    expect(nextCompetencyCode("NUM", ["NUM-01", "NUM-10", "GEO-12"])).toBe("NUM-11");
    expect(nextCompetencyCode("INF", [])).toBe("INF-01");
  });

  it("valide titres et libellés : texte simple, borné, sans caractère de contrôle", () => {
    expect(Title("  Les   fractions ")).toBe("Les fractions");
    expect(() => Title("")).toThrow(/invalid-title/);
    expect(() => Title("x".repeat(121))).toThrow(/invalid-title/);
    expect(() => CompetencyLabel("Lire‮abc")).toThrow(/invalid-competency-label/);
  });
});
