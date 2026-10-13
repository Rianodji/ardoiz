import type { Pool } from "pg";
import type { AuditTrail } from "../../shared-kernel/AuditTrail.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import type { IdGenerator, TutorSpaceId } from "../../shared-kernel/ids.js";
import { fromUuid } from "../ids/UuidV7IdGenerator.js";

/** Effacement d'un fichier du volume (images de cahier d'un élève purgé). */
export interface MediaRemover {
  remove(tutorSpaceId: TutorSpaceId, mediaId: string): Promise<void>;
}

export interface PurgeReport {
  readonly learners: number;
  readonly media: number;
  readonly invitations: number;
  readonly passwordResets: number;
  readonly auditEntries: number;
}

/**
 * Purge selon les durées de conservation (R16, hotspot H9, migration 012) :
 * - les données d'un élève 30 jours après le retrait du consentement (compte gardé comme pierre tombale
 *   anonyme, pour la trace du consentement) ;
 * - les invitations et liens de réinitialisation expirés ; le journal d'audit de plus de 6 mois.
 * Tout passe par les fonctions étroites `privacy.*`, qui lisent l'heure de la base : cette tâche ne peut
 * ni avancer une échéance ni désigner un élève. Les images effacées de la base le sont ensuite du volume.
 */
export class PurgeJob {
  constructor(
    private readonly pool: Pool,
    private readonly files: MediaRemover,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly onError: (code: string) => void,
  ) {}

  async runOnce(): Promise<PurgeReport> {
    let learners = 0;
    let media = 0;
    const { rows: due } = await this.pool.query<{ tutor_space_id: string; learner_id: string }>(
      "SELECT tutor_space_id, learner_id FROM privacy.due_learners()",
    );
    for (const row of due) {
      try {
        const { rows: purged } = await this.pool.query<{ media: string[] | null }>(
          "SELECT privacy.purge_learner($1) AS media",
          [row.learner_id],
        );
        const removed = purged[0]?.media ?? null;
        if (removed === null) continue; // plus échu entre-temps (purge concurrente) : rien à faire
        const tutorSpaceId = fromUuid("TutorSpaceId", row.tutor_space_id);
        for (const mediaId of removed) {
          try {
            await this.files.remove(tutorSpaceId, fromUuid("NotebookMediaId", mediaId));
            media++;
          } catch {
            // Fichier orphelin : il n'est plus servi (sa ligne n'existe plus) ; le journal le signale.
            this.onError("purge.media-not-removed");
          }
        }
        await this.audit.record({
          id: this.ids.next("AuditEntryId"),
          tutorSpaceId,
          action: "privacy.learner-purged",
          actor: { kind: "system" },
          targetId: fromUuid("LearnerId", row.learner_id),
          outcome: "success",
          occurredAt: this.clock.now(),
        });
        learners++;
      } catch (error) {
        this.onError(
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "purge.learner-failed",
        );
      }
    }
    const { rows } = await this.pool.query<{
      invitations: string;
      password_resets: string;
      audit_entries: string;
    }>("SELECT invitations, password_resets, audit_entries FROM privacy.purge_expired()");
    return {
      learners,
      media,
      invitations: Number(rows[0]?.invitations ?? 0),
      passwordResets: Number(rows[0]?.password_resets ?? 0),
      auditEntries: Number(rows[0]?.audit_entries ?? 0),
    };
  }
}

/** Purge périodique dans le processus (une seule instance) : toutes les heures, et une minute après le démarrage. */
export class PurgeLoop {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<unknown> = Promise.resolve();
  #stopped = false;

  constructor(
    private readonly job: PurgeJob,
    private readonly onReport: (report: PurgeReport) => void,
    private readonly onError: (code: string) => void,
    private readonly intervalMs = 3_600_000,
    private readonly firstDelayMs = 60_000,
  ) {}

  start(): void {
    this.#schedule(this.firstDelayMs);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#running;
  }

  #schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#running = this.job.runOnce().then(this.onReport, () => {
        this.onError("purge.failed");
      });
      void this.#running.then(() => {
        this.#schedule(this.intervalMs);
      });
    }, delay);
    this.#timer.unref();
  }
}
