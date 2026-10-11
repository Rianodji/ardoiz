import { identityApi } from "../../identity/index.ts";
import { lessonClock } from "../domain/Lesson.ts";

export const unlock = [identityApi, lessonClock];
