import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage } from "../../src/platform/media/LocalFileStorage.js";
import { PurgeJob } from "../../src/platform/privacy/PurgeJob.js";
import { TutorSpaceId } from "../../src/shared-kernel/ids.js";
import { startAttempt, type LearnerAttempt } from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import {
  imageElement,
  notebookAssessment,
  saveScene,
  triangle,
  uploadNotebookImage,
} from "./support/notebook.js";
import { pngImage, setupProgramme, unlock, type Programme } from "./support/programme.js";
import { LEARNER_PASSWORD, World, type Snapshot } from "./support/world.js";

/**
 * Durées de conservation (R16, hotspot H9, L7) : 30 jours après le retrait du consentement, les données
 * de l'élève sont purgées ; la trace du consentement reste. Jetons expirés et audit de plus de 6 mois aussi.
 */
describe("Purge des données échues (R16)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let programme: Programme;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    programme = await setupProgramme(base, family);
    for (const learner of [family.learner, family.otherLearner]) {
      await unlock(
        base,
        family.tutor.cookie,
        { kind: "lesson", id: programme.lessonId },
        { kind: "learner", id: learner.id },
      );
      await base.http({
        method: "POST",
        url: `/api/lessons/${programme.lessonId}/completion`,
        cookie: learner.cookie,
      });
    }
    // Lina : une copie de cahier avec une image, corrigée et publiée.
    const { assignmentId } = await notebookAssessment(base, family);
    const attempt = (await startAttempt(base, family.learner.cookie, assignmentId)).body as LearnerAttempt;
    const upload = await uploadNotebookImage(
      base,
      family.learner.cookie,
      attempt.attemptId,
      await pngImage(),
    );
    const { mediaId } = upload.body as { mediaId: string };
    await saveScene(base, family.learner.cookie, attempt, [triangle(), imageElement(mediaId)]);
    await base.http({
      method: "POST",
      url: `/api/attempts/${attempt.attemptId}/submit`,
      cookie: family.learner.cookie,
      payload: { answers: {} },
    });
    await base.http({
      method: "POST",
      url: `/api/grading/attempts/${attempt.attemptId}/grades`,
      cookie: family.tutor.cookie,
      payload: { grades: [{ questionId: attempt.questions[0]?.id, earned: 4 }] },
    });
    await base.http({
      method: "POST",
      url: `/api/grading/attempts/${attempt.attemptId}/publish`,
      cookie: family.tutor.cookie,
    });
    await base.deliverEvents();
    snapshot = await base.freeze();
  });
  afterAll(async () => {
    await World.drop(snapshot.database);
  });
  beforeEach(async () => {
    world = await snapshot.fork();
  });
  afterEach(async () => {
    await world.close();
  });

  const job = () =>
    new PurgeJob(world.pool, new LocalFileStorage(world.mediaDir), (code) => {
      throw new Error(`purge en échec : ${code}`);
    });
  /**
   * Fait passer 31 jours depuis le retrait, en tant que propriétaire (la garde R-1 ne vise que le rôle
   * d'exécution) : retrait et suppression planifiée dans le passé.
   */
  const makeDue = async (learnerId: string) => {
    await world.adminQuery(
      `UPDATE identity.parental_consents SET given_at = now() - interval '400 days', withdrawn_at = now() - interval '31 days'
        WHERE learner_id = $1`,
      [uuid(learnerId)],
    );
    await world.adminQuery(
      "UPDATE identity.accounts SET scheduled_deletion_at = now() - interval '1 minute' WHERE id = $1",
      [uuid(learnerId)],
    );
  };
  const uuid = (prefixed: string) => prefixed.slice(4);
  const withdraw = async () => {
    const res = await world.http({
      method: "POST",
      url: `/api/learners/${family.learner.id}/consent-withdrawal`,
      cookie: family.linkedGuardian,
    });
    expect(res.status).toBe(204);
  };
  const countFor = async (table: string, learnerId: string) =>
    (
      await world.adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE learner_id = $1`, [
        uuid(learnerId),
      ])
    )[0]?.n ?? 0;
  const linaMedia = async () =>
    world.adminQuery<{ id: string; tutor_space_id: string }>(
      `SELECT m.id, m.tutor_space_id FROM assessment.notebook_media m JOIN assessment.attempts a ON a.id = m.attempt_id WHERE a.learner_id = $1`,
      [uuid(family.learner.id)],
    );

  it("avant l'échéance rien n'est purgé, et le rôle d'exécution ne peut désigner aucun élève (R16)", async () => {
    await withdraw();
    expect(await job().runOnce()).toMatchObject({ learners: 0, media: 0 });
    for (const learner of [family.learner, family.otherLearner]) {
      const { rows } = await world.pool.query("SELECT privacy.purge_learner($1) AS media", [
        uuid(learner.id),
      ]);
      expect(rows).toEqual([{ media: null }]);
    }
    // Noé : compte désactivé et date échue, mais consentement encore actif → jamais purgé.
    await world.adminQuery(
      "UPDATE identity.accounts SET status = 'disabled', scheduled_deletion_at = now() - interval '1 day' WHERE id = $1",
      [uuid(family.otherLearner.id)],
    );
    expect(await job().runOnce()).toMatchObject({ learners: 0 });
    expect(await countFor("progress.xp_entries", family.otherLearner.id)).toBeGreaterThan(0);
    const { rows: due } = await world.pool.query("SELECT learner_id FROM privacy.due_learners()");
    expect(due).toEqual([]); // ni Lina (pas encore échue), ni Noé (consentement actif)
    expect(await countFor("assessment.attempts", family.learner.id)).toBe(1);
    expect(await countFor("progress.xp_entries", family.learner.id)).toBeGreaterThan(0);
  });

  it("30 jours après le retrait du consentement, tout est purgé, images comprises ; le consentement et l'autre élève restent (R16, H9)", async () => {
    await withdraw();
    const [media] = await linaMedia();
    const file = join(world.mediaDir, media?.tutor_space_id ?? "-", `${media?.id ?? "-"}.webp`);
    expect(existsSync(file)).toBe(true);
    const consentsBefore = await countFor("identity.parental_consents", family.learner.id);
    const noeXp = await countFor("progress.xp_entries", family.otherLearner.id);
    await makeDue(family.learner.id);

    expect(await job().runOnce()).toMatchObject({ learners: 1, media: 1 });
    expect(existsSync(file)).toBe(false);
    for (const table of [
      "assessment.attempts",
      "assessment.assignment_learners",
      "curriculum.lesson_completions",
      "curriculum.unlocks",
      "progress.evidences",
      "progress.grades",
      "progress.xp_entries",
      "progress.activity_weeks",
      "progress.badges",
      "identity.guardianships",
    ]) {
      expect(await countFor(table, family.learner.id), table).toBe(0);
    }
    expect(await linaMedia()).toEqual([]);
    const events = await world.adminQuery<{ n: number }>(
      "SELECT count(*)::int AS n FROM messaging.outbox WHERE payload ->> 'learnerId' = $1",
      [family.learner.id],
    );
    expect(events[0]?.n).toBe(0);
    // Pierre tombale anonyme ; la trace du consentement reste (3 ans).
    const [account] = await world.adminQuery<{
      first_name: string;
      username: string;
      purged_at: Date | null;
    }>("SELECT first_name, username, purged_at FROM identity.accounts WHERE id = $1", [
      uuid(family.learner.id),
    ]);
    expect(account).toMatchObject({
      first_name: "Supprimé",
      username: expect.stringMatching(/^supprime-[0-9a-f]{12}$/) as unknown,
    });
    expect(account?.purged_at).not.toBeNull();
    expect(await countFor("identity.parental_consents", family.learner.id)).toBe(consentsBefore);
    expect(await countFor("progress.xp_entries", family.otherLearner.id)).toBe(noeXp);
    // Journalisé, puis plus rien à faire ; une reconstruction ne le fait pas revivre.
    const audit = await world.adminQuery<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'privacy.learner-purged' AND target_id = $1",
      [family.learner.id],
    );
    expect(audit[0]?.n).toBe(1);
    expect(await job().runOnce()).toMatchObject({ learners: 0 });
    const [space] = await world.adminQuery<{ id: string }>(
      "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
    );
    await world.progress.rebuild(TutorSpaceId(`tsp_${space?.id ?? ""}`));
    expect(await countFor("progress.xp_entries", family.learner.id)).toBe(0);
    const login = await world.http({
      method: "POST",
      url: "/api/auth/login/learner",
      payload: { spaceCode: "dicard", username: "lina", password: LEARNER_PASSWORD },
    });
    expect(login.status).toBe(401);
  });

  it("le rôle d'exécution ne peut ni dater un retrait ni avancer une suppression : la base impose les dates (verdict L7 R-1)", async () => {
    const [space] = await world.adminQuery<{ id: string }>(
      "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
    );
    const asApp = async (sql: string) => {
      const client = await world.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tutor_space_id', $1, true)", [space?.id]);
        await client.query(sql, [uuid(family.learner.id)]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    // Ce qu'écrirait une injection SQL : un retrait et une suppression en 2020.
    await asApp("UPDATE identity.parental_consents SET withdrawn_at = '2020-01-01' WHERE learner_id = $1");
    await asApp(
      "UPDATE identity.accounts SET status = 'disabled', scheduled_deletion_at = '2020-01-01' WHERE id = $1",
    );
    const [dates] = await world.adminQuery<{ withdrawn_ok: boolean; deletion_ok: boolean }>(
      `SELECT bool_and(c.withdrawn_at > now() - interval '1 minute') AS withdrawn_ok,
              bool_and(a.scheduled_deletion_at > now() + interval '29 days') AS deletion_ok
         FROM identity.parental_consents c JOIN identity.accounts a ON a.id = c.learner_id WHERE a.id = $1`,
      [uuid(family.learner.id)],
    );
    expect(dates).toEqual({ withdrawn_ok: true, deletion_ok: true });
    expect((await world.pool.query("SELECT learner_id FROM privacy.due_learners()")).rows).toEqual([]);
    expect(await job().runOnce()).toMatchObject({ learners: 0 });
    // Une fois posées, ces dates ne bougent plus pour le rôle d'exécution.
    await expect(
      asApp("UPDATE identity.parental_consents SET withdrawn_at = '2020-01-01' WHERE learner_id = $1"),
    ).rejects.toThrow(/ne se modifie pas/);
    await expect(
      asApp("UPDATE identity.accounts SET scheduled_deletion_at = '2020-01-01' WHERE id = $1"),
    ).rejects.toThrow(/ne se déplace pas/);
    // Même une suppression échue ne suffit pas si le retrait a moins de 30 jours.
    await world.adminQuery(
      "UPDATE identity.accounts SET scheduled_deletion_at = now() - interval '1 minute' WHERE id = $1",
      [uuid(family.learner.id)],
    );
    expect(await job().runOnce()).toMatchObject({ learners: 0 });
  });

  it("invitations expirées et audit de plus de 6 mois purgés ; le reste du journal reste en ajout seul (R16, R12)", async () => {
    const [space] = await world.adminQuery<{ id: string }>(
      "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
    );
    await world.adminQuery(
      `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code)
       VALUES (gen_random_uuid(), $1, now() - interval '7 months', 'identity.tutor-login', 'system', NULL, NULL, 'success', NULL)`,
      [space?.id],
    );
    await world.http({
      method: "POST",
      url: "/api/invitations",
      cookie: family.tutor.cookie,
      payload: { email: "vieux@example.org" },
    });
    await world.adminQuery(
      "UPDATE identity.invitations SET created_at = now() - interval '4 days', expires_at = now() - interval '1 day' WHERE consumed_at IS NULL",
    );
    const recentAudit = async () =>
      (
        await world.adminQuery<{ n: number }>(
          "SELECT count(*)::int AS n FROM audit.audit_log WHERE occurred_at > now() - interval '6 months'",
        )
      )[0]?.n ?? 0;
    const before = await recentAudit();
    const report = await job().runOnce();
    expect(report.auditEntries).toBe(1);
    expect(report.invitations).toBeGreaterThanOrEqual(1);
    expect(await recentAudit()).toBe(before);
    await expect(world.pool.query("DELETE FROM audit.audit_log")).rejects.toThrow(/permission denied/);
    // Même le propriétaire ne peut pas effacer une entrée récente hors de la purge.
    await expect(
      world.adminQuery("DELETE FROM audit.audit_log WHERE occurred_at > now() - interval '30 days'"),
    ).rejects.toThrow(/ajout seul/);
  });
});
