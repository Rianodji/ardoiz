import { AttemptRefusedError, DraftTooFrequentError } from "./errors.js";

export interface AssignmentWindow {
  readonly opensAt: Date;
  readonly dueAt: Date;
  readonly maxAttempts: number;
  /** Le tuteur autorise le rendu en retard : la copie est alors marquée « en retard » (hotspot H7). */
  readonly lateAllowed: boolean;
}

/** Intervalle minimal entre deux sauvegardes d'un brouillon (R15). */
export const DRAFT_SAVE_INTERVAL_MS = 5_000;

/**
 * Peut-on commencer une nouvelle tentative ? Toujours selon l'horloge du SERVEUR (R5, M6) :
 * ouverte à partir de `opensAt` inclus, fermée à partir de `dueAt` inclus (sauf retard autorisé),
 * et dans la limite du nombre de tentatives.
 */
export function assertCanStart(window: AssignmentWindow, now: Date, attemptsSoFar: number): void {
  if (now.getTime() < window.opensAt.getTime()) throw new AttemptRefusedError("assessment.not-yet-open");
  // QUESTION Q16 : la durée du retard autorisé n'est pas bornée par le big picture ; aucune borne n'est inventée.
  if (now.getTime() >= window.dueAt.getTime() && !window.lateAllowed)
    throw new AttemptRefusedError("assessment.closed");
  if (attemptsSoFar >= window.maxAttempts) throw new AttemptRefusedError("assessment.no-attempts-left");
}

/** Peut-on enregistrer ou rendre ? Même fenêtre ; renvoie si la copie est en retard. */
export function assertCanWork(window: AssignmentWindow, now: Date): { late: boolean } {
  if (now.getTime() < window.opensAt.getTime()) throw new AttemptRefusedError("assessment.not-yet-open");
  const late = now.getTime() >= window.dueAt.getTime();
  if (late && !window.lateAllowed) throw new AttemptRefusedError("assessment.closed");
  return { late };
}

/** Sauvegarde automatique au plus toutes les 5 s par tentative (R15, M14). */
export function assertDraftSaveAllowed(lastSavedAt: Date | null, now: Date): void {
  if (lastSavedAt === null) return;
  const elapsed = now.getTime() - lastSavedAt.getTime();
  if (elapsed < DRAFT_SAVE_INTERVAL_MS)
    throw new DraftTooFrequentError(Math.ceil((DRAFT_SAVE_INTERVAL_MS - elapsed) / 1000));
}
