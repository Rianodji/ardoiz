import {
  AuthorLessonResponse,
  CompetencyChangeRequest,
  CompetencyChoicesResponse,
  GroupMembersRequest,
  GroupsResponse,
  IdResponse,
  LearnerProgrammeResponse,
  LessonContentRequest,
  LessonResponse,
  MediaResponse,
  NewCompetencyRequest,
  NewGroupRequest,
  NewLessonRequest,
  NewModuleRequest,
  ProgrammeResponse,
  ReferentialResponse,
  TitleChangeRequest,
  UnlockRequest,
  UnlocksResponse,
} from "@ardoiz/contracts";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "typebox";
import { actorOf } from "../../../identity/index.js";
import {
  CompetencyDomainId,
  CompetencyId,
  GroupId,
  LearnerId,
  LessonId,
  MediaId,
  ModuleId,
  SubjectId,
  UnlockId,
} from "../../../shared-kernel/ids.js";
import type { UnlockAudience, UnlockTarget } from "../../domain/access.js";
import type { AudienceService } from "../../application/AudienceService.js";
import type { LearningService } from "../../application/LearningService.js";
import type { MediaService } from "../../application/MediaService.js";
import type { ProgrammeService } from "../../application/ProgrammeService.js";
import type { ReferentialService } from "../../application/ReferentialService.js";
import { MAX_IMAGE_BYTES } from "../SharpImageIngestion.js";

export interface CurriculumHttpServices {
  readonly referential: ReferentialService;
  readonly programme: ProgrammeService;
  readonly audience: AudienceService;
  readonly learning: LearningService;
  readonly media: MediaService;
}

/** Statut HTTP des codes d'erreur de curriculum. */
export const CURRICULUM_STATUSES: Readonly<Record<string, number>> = {
  "curriculum.empty-lesson": 409,
  "curriculum.name-taken": 409,
  "curriculum.already-unlocked": 409,
  "curriculum.competency-archived": 409,
  "curriculum.image-too-large": 413,
  "curriculum.image-unsupported-type": 415,
  "curriculum.import-busy": 503,
};

const closed = { additionalProperties: false } as const;
const params = <K extends string>(key: K) =>
  Type.Object({ [key]: Type.String({ maxLength: 60 }) } as Record<K, ReturnType<typeof Type.String>>, closed);
const LessonParams = params("lessonId");
const ModuleParams = params("moduleId");
const CompetencyParams = params("competencyId");
const GroupParams = params("groupId");
const UnlockParams = params("unlockId");
const MediaParams = params("mediaId");
const LearnerParams = params("learnerId");

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

function parseTarget(target: Static<typeof UnlockRequest>["target"]): UnlockTarget {
  return target.kind === "module"
    ? { kind: "module", id: ModuleId(target.id) }
    : { kind: "lesson", id: LessonId(target.id) };
}
function parseAudience(audience: Static<typeof UnlockRequest>["audience"]): UnlockAudience {
  return audience.kind === "learner"
    ? { kind: "learner", id: LearnerId(audience.id) }
    : { kind: "group", id: GroupId(audience.id) };
}

/** Routes HTTP du programme. Chaque corps et chaque paramètre ont un schéma fermé (règle 5). */
export async function curriculumRoutes(
  app: FastifyInstance,
  services: CurriculumHttpServices,
): Promise<void> {
  const { referential, programme, audience, learning, media } = services;

  // --- Référentiel de compétences (tuteur) -----------------------------------------------
  app.get("/api/referential", { schema: { response: { 200: ReferentialResponse } } }, async (request) => {
    const tree = await referential.tree(actorOf(request));
    return {
      ...tree,
      competencies: tree.competencies.map((competency) => ({
        ...competency,
        archivedAt: iso(competency.archivedAt),
      })),
    };
  });

  app.get(
    "/api/competencies",
    { schema: { response: { 200: CompetencyChoicesResponse } } },
    async (request) => ({
      competencies: (await referential.choices(actorOf(request))).map(({ id, code, label }) => ({
        id,
        code,
        label,
      })),
    }),
  );

  app.post<{ Body: Static<typeof NewCompetencyRequest> }>(
    "/api/competencies",
    { schema: { body: NewCompetencyRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const competency = await referential.add(
        actorOf(request),
        CompetencyDomainId(request.body.domainId),
        request.body.label,
      );
      return reply.code(201).send({ id: competency.id });
    },
  );

  app.patch<{ Params: Static<typeof CompetencyParams>; Body: Static<typeof CompetencyChangeRequest> }>(
    "/api/competencies/:competencyId",
    { schema: { params: CompetencyParams, body: CompetencyChangeRequest } },
    async (request, reply) => {
      await referential.update(actorOf(request), CompetencyId(request.params.competencyId), request.body);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof CompetencyParams> }>(
    "/api/competencies/:competencyId/archive",
    { schema: { params: CompetencyParams } },
    async (request, reply) => {
      await referential.archive(actorOf(request), CompetencyId(request.params.competencyId));
      return reply.code(204).send();
    },
  );

  // --- Programme : modules et cours (tuteur) ---------------------------------------------
  app.get("/api/programme", { schema: { response: { 200: ProgrammeResponse } } }, async (request) => {
    const tree = await programme.tree(actorOf(request));
    return {
      ...tree,
      lessons: tree.lessons.map((lesson) => ({
        ...lesson,
        updatedAt: lesson.updatedAt.toISOString(),
        publishedAt: iso(lesson.publishedAt),
      })),
    };
  });

  app.post<{ Body: Static<typeof NewModuleRequest> }>(
    "/api/modules",
    { schema: { body: NewModuleRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const module = await programme.createModule(
        actorOf(request),
        SubjectId(request.body.subjectId),
        request.body.title,
      );
      return reply.code(201).send({ id: module.id });
    },
  );

  app.patch<{ Params: Static<typeof ModuleParams>; Body: Static<typeof TitleChangeRequest> }>(
    "/api/modules/:moduleId",
    { schema: { params: ModuleParams, body: TitleChangeRequest } },
    async (request, reply) => {
      await programme.updateModule(actorOf(request), ModuleId(request.params.moduleId), request.body);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: Static<typeof NewLessonRequest> }>(
    "/api/lessons",
    { schema: { body: NewLessonRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const lesson = await programme.createLesson(
        actorOf(request),
        ModuleId(request.body.moduleId),
        request.body.title,
      );
      return reply.code(201).send({ id: lesson.id });
    },
  );

  app.get<{ Params: Static<typeof LessonParams> }>(
    "/api/lessons/:lessonId/edit",
    { schema: { params: LessonParams, response: { 200: AuthorLessonResponse } } },
    async (request) => {
      const lesson = await programme.lessonForAuthor(actorOf(request), LessonId(request.params.lessonId));
      return {
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        status: lesson.status,
        content: lesson.content,
      };
    },
  );

  app.patch<{ Params: Static<typeof LessonParams>; Body: Static<typeof TitleChangeRequest> }>(
    "/api/lessons/:lessonId",
    { schema: { params: LessonParams, body: TitleChangeRequest } },
    async (request, reply) => {
      await programme.updateLesson(actorOf(request), LessonId(request.params.lessonId), request.body);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: Static<typeof LessonParams>; Body: Static<typeof LessonContentRequest> }>(
    "/api/lessons/:lessonId/content",
    { schema: { params: LessonParams, body: LessonContentRequest } },
    async (request, reply) => {
      await programme.saveContent(actorOf(request), LessonId(request.params.lessonId), request.body.content);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof LessonParams> }>(
    "/api/lessons/:lessonId/publish",
    { schema: { params: LessonParams } },
    async (request, reply) => {
      await programme.publish(actorOf(request), LessonId(request.params.lessonId));
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof LessonParams> }>(
    "/api/lessons/:lessonId/unpublish",
    { schema: { params: LessonParams } },
    async (request, reply) => {
      await programme.unpublish(actorOf(request), LessonId(request.params.lessonId));
      return reply.code(204).send();
    },
  );

  // --- Import d'image : seule route qui reçoit autre chose que du JSON (R14, R15) ----------
  await app.register((scoped, _options, done) => {
    // Analyseur limité à cette route : des octets bruts, 10 Mo au plus ; le type est vérifié par signature.
    scoped.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scoped.post<{ Params: Static<typeof LessonParams>; Body: Buffer }>(
      "/api/lessons/:lessonId/media",
      { schema: { params: LessonParams, response: { 201: MediaResponse } }, bodyLimit: MAX_IMAGE_BYTES },
      async (request, reply) => {
        const uploaded = await media.upload(
          actorOf(request),
          LessonId(request.params.lessonId),
          request.body,
        );
        return reply.code(201).send(uploaded);
      },
    );
    done();
  });

  /**
   * Média d'un cours (R3, R14) : servi seulement par cette route, après la politique d'accès du cours ;
   * type fixé, pas de devinette du navigateur (nosniff, posé globalement), affichage en ligne sous un nom généré.
   */
  app.get<{ Params: Static<typeof MediaParams> }>(
    "/api/media/:mediaId",
    { schema: { params: MediaParams } },
    async (request, reply) => {
      const mediaId = MediaId(request.params.mediaId);
      const { bytes, sha256 } = await learning.readMedia(actorOf(request), mediaId);
      return reply
        .type("image/webp")
        .header("content-disposition", `inline; filename="${mediaId}.webp"`)
        .header("etag", `"${sha256}"`)
        .send(bytes);
    },
  );

  // --- Groupes et déverrouillages (tuteur) -----------------------------------------------
  app.get("/api/groups", { schema: { response: { 200: GroupsResponse } } }, async (request) => ({
    groups: (await audience.groups(actorOf(request))).map((group) => ({
      ...group,
      learnerIds: [...group.learnerIds],
    })),
  }));

  app.post<{ Body: Static<typeof NewGroupRequest> }>(
    "/api/groups",
    { schema: { body: NewGroupRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const group = await audience.createGroup(actorOf(request), request.body.name);
      return reply.code(201).send({ id: group.id });
    },
  );

  app.put<{ Params: Static<typeof GroupParams>; Body: Static<typeof GroupMembersRequest> }>(
    "/api/groups/:groupId/members",
    { schema: { params: GroupParams, body: GroupMembersRequest } },
    async (request, reply) => {
      await audience.setMembers(
        actorOf(request),
        GroupId(request.params.groupId),
        request.body.learnerIds.map((id) => LearnerId(id)),
      );
      return reply.code(204).send();
    },
  );

  app.get("/api/unlocks", { schema: { response: { 200: UnlocksResponse } } }, async (request) => ({
    unlocks: (await audience.unlocks(actorOf(request))).map((unlock) => ({
      id: unlock.id,
      target: { ...unlock.target },
      audience: { ...unlock.audience },
      unlockedAt: unlock.unlockedAt.toISOString(),
    })),
  }));

  app.post<{ Body: Static<typeof UnlockRequest> }>(
    "/api/unlocks",
    { schema: { body: UnlockRequest, response: { 201: IdResponse } } },
    async (request, reply) => {
      const unlock = await audience.unlock(
        actorOf(request),
        parseTarget(request.body.target),
        parseAudience(request.body.audience),
      );
      return reply.code(201).send({ id: unlock.id });
    },
  );

  app.delete<{ Params: Static<typeof UnlockParams> }>(
    "/api/unlocks/:unlockId",
    { schema: { params: UnlockParams } },
    async (request, reply) => {
      await audience.relock(actorOf(request), UnlockId(request.params.unlockId));
      return reply.code(204).send();
    },
  );

  // --- Lecture (élève, parent, tuteur) ----------------------------------------------------
  app.get<{ Params: Static<typeof LessonParams> }>(
    "/api/lessons/:lessonId",
    { schema: { params: LessonParams, response: { 200: LessonResponse } } },
    async (request) => learning.readLesson(actorOf(request), LessonId(request.params.lessonId)),
  );

  app.post<{ Params: Static<typeof LessonParams> }>(
    "/api/lessons/:lessonId/completion",
    { schema: { params: LessonParams } },
    async (request, reply) => {
      await learning.completeLesson(actorOf(request), LessonId(request.params.lessonId));
      return reply.code(204).send();
    },
  );

  app.get<{ Params: Static<typeof LearnerParams> }>(
    "/api/learners/:learnerId/programme",
    { schema: { params: LearnerParams, response: { 200: LearnerProgrammeResponse } } },
    async (request) => {
      const view = await learning.programmeOf(actorOf(request), LearnerId(request.params.learnerId));
      return {
        subjects: view.subjects.map((subject) => ({
          ...subject,
          modules: subject.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) => ({ ...lesson, completedAt: iso(lesson.completedAt) })),
          })),
        })),
      };
    },
  );
}
