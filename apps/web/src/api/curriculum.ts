import {
  AuthorLessonResponse,
  CompetencyChoicesResponse,
  GroupsResponse,
  IdResponse,
  LearnerProgrammeResponse,
  LessonResponse,
  MediaResponse,
  ProgrammeResponse,
  ReferentialResponse,
  UnlocksResponse,
} from "@ardoiz/contracts";
import { validateLessonContent, type LessonContent } from "@ardoiz/content-schema";
import { ApiError, apiFetch, uploadBytes } from "./client";
import { empty, guard } from "./identity";

const path = (template: string, id: string) => template.replace(":id", encodeURIComponent(id));

export const fetchReferential = () => apiFetch("/api/referential", guard(ReferentialResponse));
export const fetchCompetencyChoices = () => apiFetch("/api/competencies", guard(CompetencyChoicesResponse));
export const addCompetency = (domainId: string, label: string) =>
  apiFetch("/api/competencies", guard(IdResponse), { method: "POST", body: { domainId, label } });
export const updateCompetency = (id: string, changes: { label?: string; position?: number }) =>
  apiFetch(path("/api/competencies/:id", id), empty, { method: "PATCH", body: changes });
export const archiveCompetency = (id: string) =>
  apiFetch(path("/api/competencies/:id/archive", id), empty, { method: "POST" });

export const fetchProgramme = () => apiFetch("/api/programme", guard(ProgrammeResponse));
export const createModule = (subjectId: string, title: string) =>
  apiFetch("/api/modules", guard(IdResponse), { method: "POST", body: { subjectId, title } });
export const createLesson = (moduleId: string, title: string) =>
  apiFetch("/api/lessons", guard(IdResponse), { method: "POST", body: { moduleId, title } });
export const renameLesson = (id: string, title: string) =>
  apiFetch(path("/api/lessons/:id", id), empty, { method: "PATCH", body: { title } });
export const fetchLessonForAuthor = (id: string) =>
  apiFetch(path("/api/lessons/:id/edit", id), guard(AuthorLessonResponse));
export const saveLessonContent = (id: string, content: unknown) =>
  apiFetch(path("/api/lessons/:id/content", id), empty, { method: "PUT", body: { content } });
export const publishLesson = (id: string) =>
  apiFetch(path("/api/lessons/:id/publish", id), empty, { method: "POST" });
export const unpublishLesson = (id: string) =>
  apiFetch(path("/api/lessons/:id/unpublish", id), empty, { method: "POST" });

/** Import d'une image : octets bruts, le serveur vérifie le type par signature et réencode (R14). */
export const uploadLessonImage = (lessonId: string, file: Blob) =>
  uploadBytes(path("/api/lessons/:id/media", lessonId), file, guard(MediaResponse));

export const fetchGroups = () => apiFetch("/api/groups", guard(GroupsResponse));
export const createGroup = (name: string) =>
  apiFetch("/api/groups", guard(IdResponse), { method: "POST", body: { name } });
export const setGroupMembers = (id: string, learnerIds: readonly string[]) =>
  apiFetch(path("/api/groups/:id/members", id), empty, { method: "PUT", body: { learnerIds } });
export const fetchUnlocks = () => apiFetch("/api/unlocks", guard(UnlocksResponse));
export const unlockContent = (
  target: { kind: "module" | "lesson"; id: string },
  audience: { kind: "learner" | "group"; id: string },
) => apiFetch("/api/unlocks", guard(IdResponse), { method: "POST", body: { target, audience } });
export const relock = (id: string) => apiFetch(path("/api/unlocks/:id", id), empty, { method: "DELETE" });

/**
 * Un cours lu par un élève, un parent ou le tuteur. Le contenu reçu repasse par le validateur du
 * schéma fermé avant d'être rendu : ce qui n'est pas conforme n'est jamais affiché (R4).
 */
export async function fetchLesson(
  id: string,
): Promise<{ id: string; title: string; content: LessonContent }> {
  const lesson = await apiFetch(path("/api/lessons/:id", id), guard(LessonResponse));
  const validation = validateLessonContent(lesson.content);
  if (!validation.ok) throw new ApiError(200, "http.unexpected-response");
  return { id: lesson.id, title: lesson.title, content: validation.value };
}
export const completeLesson = (id: string) =>
  apiFetch(path("/api/lessons/:id/completion", id), empty, { method: "POST" });
export const fetchLearnerProgramme = (learnerId: string) =>
  apiFetch(path("/api/learners/:id/programme", learnerId), guard(LearnerProgrammeResponse));
