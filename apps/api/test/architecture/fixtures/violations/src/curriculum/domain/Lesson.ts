// Fixture volontairement fautive : le domaine importe l'infrastructure, un autre module et un module natif.
import { randomUUID } from "node:crypto";
import { Guardian } from "../../identity/domain/Guardian.ts";
import { PgLessonRepository } from "../infrastructure/PgLessonRepository.ts";

export const lesson = [randomUUID, Guardian, PgLessonRepository];
