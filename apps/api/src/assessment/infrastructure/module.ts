import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Clock, RandomSource } from "../../shared-kernel/Clock.js";
import type { IdGenerator } from "../../shared-kernel/ids.js";
import { AttemptService } from "../application/AttemptService.js";
import { AuthoringService } from "../application/AuthoringService.js";
import { GradingService } from "../application/GradingService.js";
import type {
  CurriculumDirectory,
  FileStorage,
  ImageIngestion,
  LearnerDirectory,
  UploadLimiter,
} from "../application/ports.js";
import { SlidingWindowLimiter } from "../../platform/limits/SlidingWindowLimiter.js";
import type { AssessmentDependencies } from "../application/support.js";
import { CryptoRandomSource } from "../../platform/random/CryptoRandomSource.js";
import { CryptoContentHasher } from "./CryptoContentHasher.js";
import { ASSESSMENT_STATUSES, assessmentRoutes } from "./http/assessmentRoutes.js";
import { PgAssessmentGateway } from "./PgAssessmentStore.js";

export interface AssessmentModuleOptions {
  readonly pool: Pool;
  readonly curriculum: CurriculumDirectory;
  readonly learners: LearnerDirectory;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Ingestion d'images PARTAGÉE avec les cours : une seule file d'attente bornée en mémoire (R14). */
  readonly images: ImageIngestion;
  readonly files: FileStorage;
  /** Remplaçable dans les tests. */
  readonly uploads?: UploadLimiter;
  /** Remplaçable dans les tests ; aléa cryptographique par défaut. */
  readonly random?: RandomSource;
}

export interface AssessmentModule {
  readonly statuses: Readonly<Record<string, number>>;
  register(app: FastifyInstance): Promise<void>;
}

/** Assemble le module assessment à partir de ses adaptateurs. */
export function createAssessmentModule(options: AssessmentModuleOptions): AssessmentModule {
  const deps: AssessmentDependencies = {
    gateway: new PgAssessmentGateway(options.pool),
    curriculum: options.curriculum,
    learners: options.learners,
    images: options.images,
    // Une image toutes les 10 s et 20 par heure au plus, par élève (verdict L4, S-1).
    uploads:
      options.uploads ??
      new SlidingWindowLimiter([
        { limit: 1, windowMs: 10_000 },
        { limit: 20, windowMs: 3_600_000 },
      ]),
    files: options.files,
    hasher: new CryptoContentHasher(),
    random: options.random ?? new CryptoRandomSource(),
    clock: options.clock,
    ids: options.ids,
  };
  return {
    statuses: ASSESSMENT_STATUSES,
    register: (app) =>
      assessmentRoutes(app, {
        authoring: new AuthoringService(deps),
        attempts: new AttemptService(deps),
        grading: new GradingService(deps),
      }),
  };
}
