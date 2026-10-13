import { describe, expect, it } from "vitest";
import { InvalidSchedulingInput, SchedulingConflictError } from "../../src/scheduling/domain/errors.js";
import { localToUtc, utcToLocal } from "../../src/scheduling/domain/localTime.js";
import { MeetingLink } from "../../src/scheduling/domain/meetingLink.js";
import {
  assertInFuture,
  linkWindowOpen,
  occurrencesOf,
  parseRecurrence,
} from "../../src/scheduling/domain/schedule.js";

describe("Lien de visio (R9, M10)", () => {
  it.each([
    "https://meet.jit.si/ardoiz-xyz",
    "https://meet.google.com/abc-defg-hij",
    "https://us02web.zoom.us/j/123?pwd=abc",
    "https://zoom.us/j/123",
  ])("accepte « %s » (R9)", (raw) => {
    expect(MeetingLink.parse(raw, null).href).toBe(new URL(raw).href);
  });

  it.each([
    "http://meet.jit.si/ardoiz-xyz",
    "https://evil.example/zoom.us",
    "https://user:pass@meet.jit.si/x",
    "javascript:alert(1)",
    "https://meet.jit.si.evil.example/x",
    "https://evilzoom.us/j/1",
    "https://meet.jit.si:8443/x",
    "https://meet.jit.si/a b",
    "data:text/html,<script>alert(1)</script>",
    "//meet.jit.si/x",
    "",
  ])("refuse « %s » (R9)", (raw) => {
    expect(() => MeetingLink.parse(raw, null)).toThrow(InvalidSchedulingInput);
  });

  it("accepte l'hôte Jitsi supplémentaire de la configuration, et lui seul (Q5)", () => {
    expect(MeetingLink.parse("https://visio.example.org/salle", "visio.example.org").href).toBe(
      "https://visio.example.org/salle",
    );
    expect(() => MeetingLink.parse("https://visio.example.org/salle", null)).toThrow(InvalidSchedulingInput);
  });

  it("génère une salle Jitsi au nom imprévisible", () => {
    expect(MeetingLink.generatedJitsi("A1b2C3d4E5f6G7h8I9j0K1").href).toBe(
      "https://meet.jit.si/ardoiz-A1b2C3d4E5f6G7h8I9j0K1",
    );
    expect(() => MeetingLink.generatedJitsi("court")).toThrow(InvalidSchedulingInput);
  });
});

describe("Heure de Paris et changements d'heure (H8)", () => {
  it("convertit l'heure d'été (UTC+2) et l'heure d'hiver (UTC+1)", () => {
    expect(localToUtc({ date: "2026-10-14", time: "14:00" }).toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(localToUtc({ date: "2026-11-04", time: "14:00" }).toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(utcToLocal(new Date("2026-11-04T13:00:00Z"))).toEqual({ date: "2026-11-04", time: "14:00" });
  });

  it("une séance hebdomadaire à 14 h reste à 14 h heure de Paris après le passage à l'heure d'hiver (25 octobre 2026)", () => {
    const weekly = parseRecurrence({
      kind: "weekly",
      date: "2026-10-21",
      time: "14:00",
      durationMinutes: 60,
      until: "2026-11-04",
    });
    const occurrences = occurrencesOf(weekly);
    expect(occurrences.map((occurrence) => occurrence.startsAt.toISOString())).toEqual([
      "2026-10-21T12:00:00.000Z",
      "2026-10-28T13:00:00.000Z",
      "2026-11-04T13:00:00.000Z",
    ]);
    expect(occurrences.map((occurrence) => utcToLocal(occurrence.startsAt).time)).toEqual([
      "14:00",
      "14:00",
      "14:00",
    ]);
  });

  it("une séance hebdomadaire à 14 h reste à 14 h heure de Paris après le passage à l'heure d'été (29 mars 2026)", () => {
    const weekly = parseRecurrence({
      kind: "weekly",
      date: "2026-03-25",
      time: "14:00",
      durationMinutes: 60,
      until: "2026-04-01",
    });
    expect(occurrencesOf(weekly).map((occurrence) => occurrence.startsAt.toISOString())).toEqual([
      "2026-03-25T13:00:00.000Z",
      "2026-04-01T12:00:00.000Z",
    ]);
  });

  it("heure inexistante (dimanche 29 mars 2026, 2 h 30) : l'heure qui suit le saut, 3 h 30", () => {
    const instant = localToUtc({ date: "2026-03-29", time: "02:30" });
    expect(instant.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(utcToLocal(instant)).toEqual({ date: "2026-03-29", time: "03:30" });
  });

  it("heure ambiguë (dimanche 25 octobre 2026, 2 h 30) : la première, en heure d'été", () => {
    expect(localToUtc({ date: "2026-10-25", time: "02:30" }).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("une séance de 23 h à minuit franchit le jour sans erreur", () => {
    const [occurrence] = occurrencesOf(
      parseRecurrence({ kind: "once", date: "2026-12-31", time: "23:30", durationMinutes: 60 }),
    );
    expect(occurrence?.endsAt.toISOString()).toBe("2026-12-31T23:30:00.000Z");
    expect(utcToLocal(occurrence?.endsAt ?? new Date(0))).toEqual({ date: "2027-01-01", time: "00:30" });
  });

  it("refuse une date ou une heure impossibles, une durée hors bornes, une série de plus de 52 semaines", () => {
    const base = { kind: "once" as const, date: "2026-10-14", time: "14:00", durationMinutes: 60 };
    expect(() => parseRecurrence({ ...base, date: "2026-02-30" })).toThrow(InvalidSchedulingInput);
    expect(() => parseRecurrence({ ...base, time: "24:00" })).toThrow(InvalidSchedulingInput);
    expect(() => parseRecurrence({ ...base, durationMinutes: 10 })).toThrow(InvalidSchedulingInput);
    expect(() => parseRecurrence({ ...base, durationMinutes: 300 })).toThrow(InvalidSchedulingInput);
    expect(() => parseRecurrence({ ...base, kind: "weekly", until: "2027-10-14" })).toThrow(
      InvalidSchedulingInput,
    );
    expect(() => parseRecurrence({ ...base, kind: "weekly", until: "2026-10-13" })).toThrow(
      InvalidSchedulingInput,
    );
  });
});

describe("Fenêtre du lien et horloge du serveur (R9)", () => {
  const occurrence = {
    startsAt: new Date("2026-10-14T12:00:00Z"),
    endsAt: new Date("2026-10-14T13:00:00Z"),
    cancelled: false,
  };
  const at = (iso: string, seconds = 0) => new Date(new Date(iso).getTime() + seconds * 1000);

  it("lien masqué à T − 15 min − 1 s, révélé à T − 15 min (R9)", () => {
    expect(linkWindowOpen(occurrence, at("2026-10-14T11:45:00Z", -1))).toBe(false);
    expect(linkWindowOpen(occurrence, at("2026-10-14T11:45:00Z"))).toBe(true);
  });

  it("lien révélé à la fin − 1 s, masqué à la fin + 0 s (R9)", () => {
    expect(linkWindowOpen(occurrence, at("2026-10-14T13:00:00Z", -1))).toBe(true);
    expect(linkWindowOpen(occurrence, at("2026-10-14T13:00:00Z"))).toBe(false);
  });

  it("jamais de lien pour une séance annulée (R9)", () => {
    expect(linkWindowOpen({ ...occurrence, cancelled: true }, at("2026-10-14T12:10:00Z"))).toBe(false);
  });

  it("on ne planifie pas dans le passé", () => {
    expect(() => {
      assertInFuture(occurrence, at("2026-10-14T12:00:00Z"));
    }).toThrow(SchedulingConflictError);
    expect(() => {
      assertInFuture(occurrence, at("2026-10-14T11:59:59Z"));
    }).not.toThrow();
  });
});
