import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Clock } from "../../shared-kernel/Clock.js";
import type { IdGenerator } from "../../shared-kernel/ids.js";
import { SuggestionService } from "../application/SuggestionService.js";
import { feedbackRoutes } from "./http/feedbackRoutes.js";
import { PgSuggestionGateway } from "./PgSuggestionStore.js";

export interface FeedbackModuleOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface FeedbackModule {
  readonly statuses: Readonly<Record<string, number>>;
  register(app: FastifyInstance): Promise<void>;
}

/** Assemble le module feedback (suggestions des parents). */
export function createFeedbackModule(options: FeedbackModuleOptions): FeedbackModule {
  const service = new SuggestionService({
    gateway: new PgSuggestionGateway(options.pool),
    clock: options.clock,
    ids: options.ids,
  });
  return { statuses: {}, register: (app) => feedbackRoutes(app, service) };
}
