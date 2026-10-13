import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { CryptoRandomSource } from "../../platform/random/CryptoRandomSource.js";
import type { Clock, RandomSource } from "../../shared-kernel/Clock.js";
import type { IdGenerator } from "../../shared-kernel/ids.js";
import type { GroupDirectory, LearnerDirectory } from "../application/ports.js";
import { SchedulingService } from "../application/SchedulingService.js";
import { SCHEDULING_STATUSES, schedulingRoutes } from "./http/schedulingRoutes.js";
import { PgSchedulingGateway } from "./PgSchedulingStore.js";

export interface SchedulingModuleOptions {
  readonly pool: Pool;
  readonly learners: LearnerDirectory;
  readonly groups: GroupDirectory;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Hôte Jitsi supplémentaire accepté (MEETING_EXTRA_HOST, Q5), ou rien. */
  readonly extraMeetingHost?: string;
  readonly random?: RandomSource;
}

export interface SchedulingModule {
  readonly statuses: Readonly<Record<string, number>>;
  register(app: FastifyInstance): Promise<void>;
}

/** Assemble le module scheduling à partir de ses adaptateurs. */
export function createSchedulingModule(options: SchedulingModuleOptions): SchedulingModule {
  const service = new SchedulingService({
    gateway: new PgSchedulingGateway(options.pool),
    learners: options.learners,
    groups: options.groups,
    random: options.random ?? new CryptoRandomSource(),
    clock: options.clock,
    ids: options.ids,
    extraMeetingHost: options.extraMeetingHost ?? null,
  });
  return { statuses: SCHEDULING_STATUSES, register: (app) => schedulingRoutes(app, service) };
}
