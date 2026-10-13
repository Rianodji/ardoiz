import { expect } from "vitest";
import type { HttpResult, World } from "./world.js";

export interface PlanOptions {
  readonly title?: string;
  readonly learnerId?: string;
  readonly groupId?: string;
  readonly kind?: "once" | "weekly";
  readonly date: string;
  readonly time: string;
  readonly durationMinutes?: number;
  readonly until?: string;
  readonly link?: string;
}

export const planSession = (world: World, tutor: string, options: PlanOptions): Promise<HttpResult> =>
  world.http({
    method: "POST",
    url: "/api/sessions",
    cookie: tutor,
    payload: {
      title: options.title ?? "Séance de mathématiques",
      audience:
        options.groupId === undefined
          ? { kind: "learner", id: options.learnerId }
          : { kind: "group", id: options.groupId },
      schedule: {
        kind: options.kind ?? "once",
        date: options.date,
        time: options.time,
        durationMinutes: options.durationMinutes ?? 60,
        ...(options.until === undefined ? {} : { until: options.until }),
      },
      ...(options.link === undefined ? {} : { link: options.link }),
    },
  });

export interface TutorSession {
  readonly id: string;
  readonly meetingLink: string;
  readonly occurrences: Array<{
    occurrenceId: string;
    startsAt: string;
    local: { date: string; start: string };
    status: string;
  }>;
}

/** Planifie une séance et renvoie ses occurrences, telles que le tuteur les voit. */
export async function plannedSession(
  world: World,
  tutor: string,
  options: PlanOptions,
): Promise<TutorSession> {
  const planned = await planSession(world, tutor, options);
  expect(planned.status, JSON.stringify(planned.body)).toBe(201);
  const { id } = planned.body as { id: string };
  const list = (await world.http({ method: "GET", url: "/api/sessions", cookie: tutor })).body as {
    sessions: TutorSession[];
  };
  const session = list.sessions.find((candidate) => candidate.id === id);
  if (session === undefined) throw new Error("Séance introuvable.");
  return session;
}
