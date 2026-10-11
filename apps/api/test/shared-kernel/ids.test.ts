import { describe, expect, it } from "vitest";
import { fromUuid, toUuid, UuidV7IdGenerator } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { uuidv7 } from "../../src/platform/ids/uuidv7.js";
import { InvalidIdentifierError } from "../../src/shared-kernel/DomainError.js";
import { ID_PREFIXES, LearnerId, LessonId } from "../../src/shared-kernel/ids.js";
import { FixedClock } from "../support/clock.js";

const clock = new FixedClock(new Date("2026-10-11T08:00:00Z"));
const ids = new UuidV7IdGenerator(clock);

describe("Identifiants typés (noyau partagé)", () => {
  it("chaque type a un préfixe unique de trois lettres", () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[a-z]{3}$/);
  });

  it("génère un identifiant préfixé, UUID version 7, qui passe son propre analyseur", () => {
    const id = ids.next("LearnerId");
    expect(id).toMatch(/^lrn_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(LearnerId(id)).toBe(id);
  });

  it("refuse un identifiant d'un autre type (un élève n'est pas un cours)", () => {
    const learner = ids.next("LearnerId");
    expect(() => LessonId(learner)).toThrow(InvalidIdentifierError);
  });

  it.each([
    ["une injection SQL", "lrn_1 OR 1=1"],
    ["un UUID version 4", "lrn_0d6e1f5a-8c1b-4c3e-9a2b-1c2d3e4f5a6b"],
    ["des majuscules", "LRN_01920000-0000-7000-8000-000000000000"],
    ["un nombre", 42],
    ["undefined", undefined],
  ])("refuse %s", (_label, raw) => {
    expect(() => LearnerId(raw)).toThrow(InvalidIdentifierError);
  });

  it("ordonne les identifiants dans le temps (UUIDv7) et ne les répète pas", () => {
    const first = uuidv7(Date.UTC(2026, 9, 11));
    const second = uuidv7(Date.UTC(2026, 9, 12));
    expect(first < second).toBe(true);
    const many = new Set(Array.from({ length: 1000 }, () => uuidv7(Date.UTC(2026, 9, 11))));
    expect(many.size).toBe(1000);
  });

  it("se convertit en uuid pour la base, puis se relit avec son type", () => {
    const id = ids.next("TutorSpaceId");
    expect(fromUuid("TutorSpaceId", toUuid(id))).toBe(id);
  });
});
