import { describe, expect, it } from "vitest";
import { hourFr, localHourFr, longDateTime, NBSP, shortDateTime, weekdayHour } from "../src/ui/format";

/** Rend visibles les espaces insécables dans les messages d'échec : « · » pour U+00A0. */
const shown = (text: string) => text.replaceAll(NBSP, "·");

describe("Heures écrites en clair (verdict L8, S-1 et S-2)", () => {
  it("S-2 : un seul format, « 18 h » ou « 2 h 55 », jamais « 02:55 »", () => {
    expect(shown(hourFr("2026-10-15T00:55:00Z"))).toBe("2·h·55");
    expect(shown(hourFr("2026-10-15T16:00:00Z"))).toBe("18·h");
    expect(shown(localHourFr("02:55"))).toBe("2·h·55");
    expect(shown(localHourFr("14:00"))).toBe("14·h");
    expect(shown(localHourFr("09:05"))).toBe("9·h·05");
    // Journal d'audit, appareils, file de correction : plus de « 15 oct. à 02:55 ».
    expect(shown(shortDateTime("2026-10-15T00:55:00Z"))).toBe("15 oct. à·2·h·55");
  });

  it("S-1 : l'heure ne se coupe jamais, ni de son « à », ni de son jour", () => {
    const text = longDateTime("2026-10-15T00:55:00Z");
    expect(shown(text)).toBe("jeudi 15 octobre à·2·h·55");
    // Le seul endroit où la ligne peut se couper est entre les mots de la date.
    expect(text.split(" ")).toEqual(["jeudi", "15", "octobre", `à${NBSP}2${NBSP}h${NBSP}55`]);
    expect(shown(weekdayHour("2026-10-16T16:00:00Z"))).toBe("vendredi·18·h");
  });

  it("aucun format horaire « hh:mm » ne sort du formateur", () => {
    for (const iso of ["2026-01-01T00:00:00Z", "2026-07-14T21:59:00Z", "2026-10-25T01:30:00Z"])
      for (const text of [hourFr(iso), longDateTime(iso), shortDateTime(iso), weekdayHour(iso)])
        expect(text).not.toMatch(/\d:\d/);
  });
});
