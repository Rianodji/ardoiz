import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Clock } from "../../shared-kernel/Clock.js";
import type { IdGenerator, TutorSpaceId } from "../../shared-kernel/ids.js";
import { AudienceService } from "../application/AudienceService.js";
import { LearningService } from "../application/LearningService.js";
import { MediaService } from "../application/MediaService.js";
import { ProgrammeService } from "../application/ProgrammeService.js";
import { ReferentialService } from "../application/ReferentialService.js";
import type { CurriculumDependencies } from "../application/support.js";
import { parseReferential } from "../domain/referential.js";
import { CURRICULUM_STATUSES, curriculumRoutes } from "./http/curriculumRoutes.js";
import { LocalFileStorage } from "./LocalFileStorage.js";
import { PgCurriculumGateway } from "./PgCurriculumStore.js";
import { SharpImageIngestion } from "./SharpImageIngestion.js";

export interface CurriculumModuleOptions {
  readonly pool: Pool;
  readonly mediaDir: string;
  readonly referentialFile: string;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface CurriculumModule {
  readonly statuses: Readonly<Record<string, number>>;
  register(app: FastifyInstance): Promise<void>;
  /** Charge le référentiel validé dans un espace (idempotent) ; renvoie le nombre de compétences ajoutées. */
  seedReferential(tutorSpaceId: TutorSpaceId): Promise<{ added: number }>;
}

/** Assemble le module curriculum à partir de ses adaptateurs. */
export function createCurriculumModule(options: CurriculumModuleOptions): CurriculumModule {
  const deps: CurriculumDependencies = {
    gateway: new PgCurriculumGateway(options.pool),
    files: new LocalFileStorage(options.mediaDir),
    images: new SharpImageIngestion(),
    clock: options.clock,
    ids: options.ids,
  };
  const referential = new ReferentialService(deps);
  return {
    statuses: CURRICULUM_STATUSES,
    register: (app) =>
      curriculumRoutes(app, {
        referential,
        programme: new ProgrammeService(deps),
        audience: new AudienceService(deps),
        learning: new LearningService(deps),
        media: new MediaService(deps),
      }),
    seedReferential: (tutorSpaceId) =>
      referential.seed(tutorSpaceId, parseReferential(readFileSync(options.referentialFile, "utf8"))),
  };
}
