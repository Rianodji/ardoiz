import { describe, expect, it } from "vitest";
import { earnedBadges, type BadgeFacts } from "../../src/progress/domain/badges.js";
import { levelForXp, questionSucceeded, xpForLevel } from "../../src/progress/domain/experience.js";
import {
  computedLevel,
  currentLevel,
  isAcquired,
  levelHistory,
  type Evidence,
} from "../../src/progress/domain/mastery.js";
import { mondayOf, parisDate, streakOf } from "../../src/progress/domain/streak.js";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 12));
/** Preuves au taux `percent` (sur 100 points), une copie par preuve, datées dans l'ordre. */
const evidences = (...percents: number[]): Evidence[] =>
  percents.map((percent, index) => ({
    earned: percent,
    points: 100,
    recordedAt: day(index),
    copyId: `att_${String(index)}`,
  }));
/** Une seule copie : toutes les preuves publiées au même instant. */
const oneCopy = (copyId: string, at: Date, ...percents: number[]): Evidence[] =>
  percents.map((percent) => ({ earned: percent, points: 100, recordedAt: at, copyId }));

describe("Niveau de compétence aux bornes (big picture §8)", () => {
  it.each([
    [[39], "not_acquired"],
    [[40], "in_progress"],
    [[69], "in_progress"],
    [[70], "acquired"],
    [[89], "acquired"],
    [[90, 90], "acquired"],
    [[90, 90, 90], "exceeded"],
    [[100, 100], "acquired"],
    [[100, 80, 90], "exceeded"],
  ] as const)("%j → %s", (percents, level) => {
    expect(computedLevel(evidences(...percents))).toBe(level);
  });

  it("aucune preuve : non évalué", () => {
    expect(computedLevel([])).toBe("not_assessed");
  });

  it("calcul exact : 2/3 et 1/3 donnent 50 %, en cours d'acquisition ; 89,5 % reste « acquis »", () => {
    const thirds: Evidence[] = [
      { earned: 2, points: 3, recordedAt: day(0), copyId: "a" },
      { earned: 1, points: 3, recordedAt: day(1), copyId: "b" },
    ];
    expect(computedLevel(thirds)).toBe("in_progress");
    expect(computedLevel([{ earned: 89.5, points: 100, recordedAt: day(0), copyId: "a" }])).toBe("acquired");
  });

  it("ne garde que les 5 dernières preuves", () => {
    expect(computedLevel(evidences(0, 0, 0, 100, 100, 100, 100, 100))).toBe("exceeded");
    expect(computedLevel(evidences(100, 100, 100, 0, 0, 0, 0, 0))).toBe("not_acquired");
  });

  it("l'ajustement du tuteur prime jusqu'à la preuve suivante", () => {
    const before = evidences(10, 20);
    const adjustment = { level: "acquired" as const, adjustedAt: day(5) };
    expect(currentLevel(before, adjustment)).toBe("acquired");
    const after = [...before, { earned: 30, points: 100, recordedAt: day(6), copyId: "c" }];
    expect(currentLevel(after, adjustment)).toBe("not_acquired");
  });
});

describe("Évolution d'un niveau : copie après copie (big picture §8, verdict L6 S-2)", () => {
  it("une copie, 1 bonne puis 3 fausses : jamais « acquis » en cours de route, donc pas de points « compétence acquise »", () => {
    const copy = oneCopy("att_1", day(0), 100, 0, 0, 0);
    expect(levelHistory(copy)).toEqual(["not_acquired"]);
    expect(levelHistory(copy).some(isAcquired)).toBe(false);
  });

  it("une copie, 1 fausse puis 3 bonnes : pas de badge « Persévérant » sur une seule copie", () => {
    const copy = oneCopy("att_1", day(0), 0, 100, 100, 100);
    expect(levelHistory(copy)).toEqual(["acquired"]);
    expect(
      earnedBadges({
        submittedCopies: 1,
        levelsByCode: new Map(),
        conversions: [],
        bestStreak: 0,
        evidencesByCompetency: new Map([["c", copy]]),
      }),
    ).toEqual(["first-step"]);
  });

  it("deux copies, « non acquis » puis « acquis » : le badge « Persévérant » est mérité", () => {
    const evidencesOverTime = [
      ...oneCopy("att_1", day(0), 0),
      ...oneCopy("att_2", day(7), 100, 100, 100, 100),
    ];
    expect(levelHistory(evidencesOverTime)).toEqual(["not_acquired", "acquired"]);
    expect(
      earnedBadges({
        submittedCopies: 2,
        levelsByCode: new Map(),
        conversions: [],
        bestStreak: 0,
        evidencesByCompetency: new Map([["c", evidencesOverTime]]),
      }),
    ).toEqual(["first-step", "persevering"]);
  });

  it("l'ordre des questions dans une copie ne change pas le résultat", () => {
    expect(levelHistory(oneCopy("a", day(0), 100, 0, 0, 0))).toEqual(
      levelHistory(oneCopy("a", day(0), 0, 0, 0, 100)),
    );
  });
});

describe("Points d'expérience et niveaux (big picture §8)", () => {
  it("niveau n atteint à 100 × n × (n + 1) / 2 points", () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([100, 300, 600, 1000]);
    expect([0, 99, 100, 299, 300, 599, 600].map(levelForXp)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it("une question est réussie à 70 % des points au moins", () => {
    expect(questionSucceeded(3.5, 5)).toBe(true);
    expect(questionSucceeded(3, 5)).toBe(false);
    expect(questionSucceeded(0, 0)).toBe(false);
  });
});

describe("Série hebdomadaire (R17)", () => {
  const weeks = (...mondays: string[]) => new Set(mondays);

  it("semaines consécutives : la série s'allonge", () => {
    expect(streakOf(weeks("2026-10-05", "2026-10-12", "2026-10-19"), "2026-10-19")).toEqual({
      current: 3,
      best: 3,
      paused: false,
    });
  });

  it("une semaine inactive met la série en pause, sans la remettre à zéro (R17)", () => {
    expect(streakOf(weeks("2026-10-05", "2026-10-12"), "2026-10-26")).toEqual({
      current: 2,
      best: 2,
      paused: true,
    });
    expect(streakOf(weeks("2026-10-05", "2026-10-12", "2026-10-26"), "2026-10-26")).toEqual({
      current: 3,
      best: 3,
      paused: false,
    });
  });

  it("deux semaines inactives dans le même mois remettent la série à zéro (R17)", () => {
    expect(streakOf(weeks("2026-10-05", "2026-10-12"), "2026-11-02")).toEqual({
      current: 0,
      best: 2,
      paused: false,
    });
  });

  it("une semaine vide par mois, deux mois de suite : jamais de remise à zéro (R17)", () => {
    // Vides : semaine du 26 octobre (octobre) puis semaine du 9 novembre (novembre).
    const state = streakOf(weeks("2026-10-12", "2026-10-19", "2026-11-02", "2026-11-16"), "2026-11-16");
    expect(state).toEqual({ current: 4, best: 4, paused: false });
  });

  it("la semaine en cours, encore vide, n'est pas une semaine manquée", () => {
    expect(streakOf(weeks("2026-10-05", "2026-10-12"), "2026-10-19")).toEqual({
      current: 2,
      best: 2,
      paused: false,
    });
  });

  it("semaine en heure de Paris : dimanche 23 h 30 et lundi 0 h 30 ne sont pas la même semaine", () => {
    expect(mondayOf(parisDate(new Date("2026-10-18T21:30:00Z")))).toBe("2026-10-12");
    expect(mondayOf(parisDate(new Date("2026-10-18T22:30:00Z")))).toBe("2026-10-19");
  });
});

describe("Badges du J1 (big picture §8)", () => {
  const facts = (overrides: Partial<BadgeFacts>): BadgeFacts => ({
    submittedCopies: 0,
    levelsByCode: new Map(),
    conversions: [],
    bestStreak: 0,
    evidencesByCompetency: new Map(),
    ...overrides,
  });

  it("Premier pas, Géomètre, Maître des unités, Assidu, Persévérant", () => {
    expect(earnedBadges(facts({ submittedCopies: 1 }))).toEqual(["first-step"]);
    const geo = new Map(
      ["GEO-01", "GEO-02", "GEO-03", "GEO-04", "GEO-05"].map((code) => [code, "acquired" as const]),
    );
    expect(earnedBadges(facts({ levelsByCode: geo }))).toEqual(["geometer"]);
    expect(earnedBadges(facts({ levelsByCode: new Map([...geo].slice(0, 4)) }))).toEqual([]);
    expect(earnedBadges(facts({ conversions: Array<boolean>(10).fill(true) }))).toEqual(["units-master"]);
    expect(earnedBadges(facts({ conversions: [...Array<boolean>(9).fill(true), false, true] }))).toEqual([]);
    expect(earnedBadges(facts({ bestStreak: 4 }))).toEqual(["assiduous"]);
    expect(earnedBadges(facts({ bestStreak: 3 }))).toEqual([]);
    expect(
      earnedBadges(facts({ evidencesByCompetency: new Map([["c", evidences(10, 90, 90, 90, 90)]]) })),
    ).toEqual(["persevering"]);
    expect(earnedBadges(facts({ evidencesByCompetency: new Map([["c", evidences(50, 80)]]) }))).toEqual([]);
  });
});
