import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { EventSubscriber } from "../../platform/messaging/OutboxRelay.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import type { IdGenerator, TutorSpaceId } from "../../shared-kernel/ids.js";
import type { CurriculumCatalog, LearnerDirectory } from "../application/ports.js";
import { ProgressService } from "../application/ProgressService.js";
import { progressSubscribers, rebuildProgress } from "./events.js";
import { progressRoutes } from "./http/progressRoutes.js";
import { PgProgressGateway } from "./PgProgressStore.js";

export interface ProgressModuleOptions {
  readonly pool: Pool;
  readonly catalog: CurriculumCatalog;
  readonly learners: LearnerDirectory;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ProgressModule {
  readonly statuses: Readonly<Record<string, number>>;
  /** Consommateurs de CorrectionPubliée, NoteRectifiée, CopieRendue, CoursTerminé, SéanceRejointe. */
  readonly subscribers: readonly EventSubscriber[];
  register(app: FastifyInstance): Promise<void>;
  /**
   * Reconstruit les projections d'un espace depuis l'outbox. Échoue sur un événement illisible, sauf
   * avec `skipUnreadable` (ADR-0001, amendement du 2026-10-13).
   */
  rebuild(
    tutorSpaceId: TutorSpaceId,
    options?: { readonly skipUnreadable: boolean },
  ): Promise<{ applied: number; skipped: number }>;
}

/** Assemble le module progress à partir de ses adaptateurs. */
export function createProgressModule(options: ProgressModuleOptions): ProgressModule {
  const service = new ProgressService({
    gateway: new PgProgressGateway(options.pool),
    catalog: options.catalog,
    learners: options.learners,
    clock: options.clock,
    ids: options.ids,
  });
  return {
    statuses: {},
    subscribers: progressSubscribers(service),
    register: (app) => progressRoutes(app, service),
    rebuild: (tutorSpaceId, rebuildOptions = { skipUnreadable: false }) =>
      withTenantTransaction(options.pool, tutorSpaceId, (client) =>
        rebuildProgress(client, service, tutorSpaceId, rebuildOptions),
      ),
  };
}
