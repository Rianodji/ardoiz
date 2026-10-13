import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Clock } from "../../shared-kernel/Clock.js";
import type {
  CompetencyId,
  GroupId,
  IdGenerator,
  LearnerId,
  SubjectId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import { AudienceService } from "../application/AudienceService.js";
import { LearningService } from "../application/LearningService.js";
import { MediaService } from "../application/MediaService.js";
import { ProgrammeService } from "../application/ProgrammeService.js";
import { ReferentialService } from "../application/ReferentialService.js";
import type { CurriculumDependencies } from "../application/support.js";
import { parseReferential } from "../domain/referential.js";
import { CURRICULUM_STATUSES, curriculumRoutes } from "./http/curriculumRoutes.js";
import { LocalFileStorage } from "../../platform/media/LocalFileStorage.js";
import { PgCurriculumGateway } from "./PgCurriculumStore.js";
import { SharpImageIngestion } from "../../platform/media/SharpImageIngestion.js";

export interface CurriculumModuleOptions {
  readonly pool: Pool;
  readonly mediaDir: string;
  /** Ingestion d'images partagée avec le cahier (une seule file d'attente, verdict L2 S-3). */
  readonly images?: SharpImageIngestion;
  readonly referentialFile: string;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Ce que le programme expose aux autres modules (évaluation) : matières, compétences proposées au
 * choix (non archivées), élèves d'un groupe. Lecture seule, identifiants seulement.
 */
export interface CurriculumDirectory {
  subjectExists(tutorSpaceId: TutorSpaceId, subjectId: SubjectId): Promise<boolean>;
  activeCompetencyIds(tutorSpaceId: TutorSpaceId): Promise<ReadonlySet<CompetencyId>>;
  learnersOfGroup(tutorSpaceId: TutorSpaceId, groupId: GroupId): Promise<LearnerId[] | null>;
  /** Compétences du référentiel (archivées comprises : une preuve ancienne reste lisible), avec leur matière. */
  competencyCatalog(tutorSpaceId: TutorSpaceId): Promise<CompetencyCatalogEntry[]>;
  /** Groupes et leurs élèves (synthèse du tuteur). */
  groups(tutorSpaceId: TutorSpaceId): Promise<Array<{ id: GroupId; name: string; learnerIds: LearnerId[] }>>;
}

export interface CompetencyCatalogEntry {
  readonly id: CompetencyId;
  readonly code: string;
  readonly label: string;
  readonly archived: boolean;
  readonly subjectId: SubjectId;
  readonly subjectName: string;
}

export interface CurriculumModule {
  readonly directory: CurriculumDirectory;
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
    images: options.images ?? new SharpImageIngestion(),
    clock: options.clock,
    ids: options.ids,
  };
  const referential = new ReferentialService(deps);
  const directory: CurriculumDirectory = {
    subjectExists: (tutorSpaceId, subjectId) =>
      deps.gateway.inSpace(tutorSpaceId, async (store) =>
        (await store.subjects()).some((subject) => subject.id === subjectId),
      ),
    activeCompetencyIds: (tutorSpaceId) =>
      deps.gateway.inSpace(
        tutorSpaceId,
        async (store) =>
          new Set(
            (await store.competencies())
              .filter((competency) => competency.archivedAt === null)
              .map((competency) => competency.id),
          ),
      ),
    competencyCatalog: (tutorSpaceId) =>
      deps.gateway.inSpace(tutorSpaceId, async (store) => {
        const subjects = new Map((await store.subjects()).map((subject) => [subject.id as string, subject]));
        const domains = new Map((await store.domains()).map((domain) => [domain.id as string, domain]));
        return (await store.competencies()).flatMap((competency) => {
          const domain = domains.get(competency.domainId);
          const subject = domain === undefined ? undefined : subjects.get(domain.subjectId);
          return domain === undefined || subject === undefined
            ? []
            : [
                {
                  id: competency.id,
                  code: competency.code,
                  label: competency.label,
                  archived: competency.archivedAt !== null,
                  subjectId: subject.id,
                  subjectName: subject.name,
                },
              ];
        });
      }),
    groups: (tutorSpaceId) =>
      deps.gateway.inSpace(tutorSpaceId, async (store) =>
        (await store.groups()).map((group) => ({
          id: group.id,
          name: group.name,
          learnerIds: [...group.learnerIds],
        })),
      ),
    learnersOfGroup: (tutorSpaceId, groupId) =>
      deps.gateway.inSpace(tutorSpaceId, async (store) => {
        const group = (await store.groups()).find((candidate) => candidate.id === groupId);
        return group === undefined ? null : [...group.learnerIds];
      }),
  };
  return {
    directory,
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
