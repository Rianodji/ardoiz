import type { Clock } from "../../shared-kernel/Clock.ts";

export const lessonClock = (clock: Clock): Date => clock.now();
