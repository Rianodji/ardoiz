import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agenda, mondayOf, parisToday } from "../src/pages/AgendaPages";
import { json, stubServer } from "./support";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const occurrence = (id: string, startsAt: string, endsAt: string, start: string) => ({
  occurrenceId: id,
  sessionId: "tss_1",
  title: `Séance ${id}`,
  startsAt,
  endsAt,
  local: { date: "2026-10-14", start, end: "15:00" },
  status: "scheduled",
  moved: false,
  participantIds: [],
  linkAvailableFrom: new Date(Date.parse(startsAt) - 15 * 60_000).toISOString(),
  meetingLink: null,
});

function renderAgenda() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Agenda canJoin />
    </QueryClientProvider>,
  );
}

describe("Dates de l'agenda (H8)", () => {
  it("lundi de la semaine, et décalage de semaines", () => {
    expect(mondayOf("2026-10-14")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-14", 1)).toBe("2026-10-19");
  });

  it("date du jour en heure de Paris, et non en UTC", () => {
    expect(parisToday(new Date("2026-10-13T22:30:00Z"))).toBe("2026-10-14");
  });
});

describe("Agenda de l'élève (R9)", () => {
  it("« Rejoindre » n'est actif que dans la fenêtre ; le lien n'arrive qu'au clic et s'ouvre sans lien avec Ardoiz (R9)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T11:50:00Z") });
    const calls = stubServer((url, init) => {
      if (url.startsWith("/api/agenda?"))
        return json(200, {
          occurrences: [
            occurrence("soc_1", "2026-10-14T12:00:00.000Z", "2026-10-14T13:00:00.000Z", "14:00"),
            occurrence("soc_2", "2026-10-14T16:00:00.000Z", "2026-10-14T17:00:00.000Z", "18:00"),
          ],
        });
      if (url === "/api/occurrences/soc_1/join" && init?.method === "POST")
        return json(200, { meetingLink: "https://meet.jit.si/ardoiz-abc" });
      return undefined;
    });
    renderAgenda();
    const [now, later] = await screen.findAllByRole("button", { name: /^Rejoindre/ });
    expect(now?.textContent).toBe("Rejoindre");
    expect(now?.hasAttribute("disabled")).toBe(false);
    expect(later?.hasAttribute("disabled")).toBe(true);
    // L'heure d'ouverture est écrite en clair, en heure de Paris (charte §7, H8).
    expect(later?.textContent).toBe("Rejoindre · possible dès 17 h 45");
    expect(document.body.textContent).not.toContain("meet.jit.si");
    expect(
      [...document.querySelectorAll("[href]")].map((element) => element.getAttribute("href")),
    ).not.toContainEqual(expect.stringContaining("meet.jit.si"));
    fireEvent.click(now as HTMLElement);
    const link = await screen.findByRole("link", { name: "Ouvrir la salle de visio" });
    expect(link.getAttribute("href")).toBe("https://meet.jit.si/ardoiz-abc");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(calls.filter((call) => call.url.endsWith("/join"))).toHaveLength(1);
  });
});
