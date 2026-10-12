import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginGuardian, startAttempt, type LearnerAttempt } from "./support/assessment.js";
import { setupFamily, type Family } from "./support/families.js";
import {
  expectStatus,
  imageElement,
  notebookAnswer,
  notebookAssessment,
  rectangle,
  saveScene,
  textElement,
  triangle,
  uploadNotebookImage,
} from "./support/notebook.js";
import { pngImage } from "./support/programme.js";
import { World, type Snapshot } from "./support/world.js";

describe("Cahier virtuel (L4, ADR-0004)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let assignmentId: string;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    assignmentId = (await notebookAssessment(base, family)).assignmentId;
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

  const lina = () => family.learner.cookie;
  const tutor = () => family.tutor.cookie;
  const start = async (): Promise<LearnerAttempt> => {
    const res = await startAttempt(world, lina(), assignmentId);
    expectStatus(res, 200);
    return res.body as LearnerAttempt;
  };
  const submit = (attempt: LearnerAttempt) =>
    world.http({
      method: "POST",
      url: `/api/attempts/${attempt.attemptId}/submit`,
      cookie: lina(),
      payload: {},
    });
  const view = async (attemptId: string, cookie: string) =>
    world.http({ method: "GET", url: `/api/attempts/${attemptId}`, cookie });

  describe("Scène de l'élève (R4, R15)", () => {
    it("refuse une scène de plus de 5 Mo avec le motif « cahier trop volumineux » (R15)", async () => {
      const attempt = await start();
      // 1 600 traits de 230 points : un peu plus de 5 Mo de JSON, sous la limite du corps de la requête.
      const { startBinding, endBinding, startArrowhead, endArrowhead, ...line } = triangle();
      void [startBinding, endBinding, startArrowhead, endArrowhead];
      const elements = Array.from({ length: 1_600 }, (_, i) => ({
        ...line,
        id: `s${String(i)}`,
        type: "freedraw",
        points: Array.from({ length: 230 }, (_, k) => [k * 1.25, k * 2.5]),
        pressures: [],
        simulatePressure: true,
      }));
      const size = JSON.stringify(notebookAnswer(attempt, elements)).length;
      expect(size).toBeGreaterThan(5_000_000);
      expect(size).toBeLessThan(5 * 1024 * 1024 + 256 * 1024);
      const res = await saveScene(world, lina(), attempt, elements);
      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({ code: "assessment.notebook-too-large" });
    });

    it("une sauvegarde du cahier plus fréquente que toutes les 5 s est limitée (R15)", async () => {
      const attempt = await start();
      expectStatus(await saveScene(world, lina(), attempt, [triangle()]), 204);
      const tooSoon = await saveScene(world, lina(), attempt, [triangle(), rectangle("r2")]);
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.headers["retry-after"]).toBe("5");
      world.clock.advanceBy(5_000);
      expectStatus(await saveScene(world, lina(), attempt, [triangle(), rectangle("r2")]), 204);
    });

    it("un texte contenant du HTML ou du script est enregistré et renvoyé comme du texte (R4)", async () => {
      const attempt = await start();
      const payload = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
      expectStatus(await saveScene(world, lina(), attempt, [textElement("t1", payload)]), 204);
      const body = (await view(attempt.attemptId, lina())).body as {
        answers: Record<string, { elements: Array<{ text: string }> }>;
      };
      expect(body.answers[attempt.questions[0]?.id ?? ""]?.elements[0]?.text).toBe(payload);
    });

    it("refuse un lien, une clé inconnue ou une image intégrée dans la scène (R4, R14)", async () => {
      const attempt = await start();
      for (const element of [
        { ...rectangle("r1"), link: "javascript:alert(1)" },
        { ...rectangle("r1"), customData: { html: "<b>" } },
        imageElement("data:image/png;base64,iVBORw0KGgo="),
      ]) {
        world.clock.advanceBy(5_000);
        const res = await saveScene(world, lina(), attempt, [element]);
        expect(res.status, JSON.stringify(element).slice(0, 60)).toBe(422);
        expect(res.body).toMatchObject({ code: "assessment.invalid-notebook" });
      }
    });

    it("la réponse modèle du cahier n'est montrée qu'après la révélation du corrigé (R5)", async () => {
      const attempt = await start();
      await saveScene(world, lina(), attempt, [triangle()]);
      await submit(attempt);
      await world.http({
        method: "POST",
        url: `/api/grading/attempts/${attempt.attemptId}/grades`,
        cookie: tutor(),
        payload: { grades: [{ questionId: attempt.questions[0]?.id, earned: 5 }] },
      });
      expectStatus(
        await world.http({
          method: "POST",
          url: `/api/grading/attempts/${attempt.attemptId}/publish`,
          cookie: tutor(),
        }),
        204,
      );
      expect(JSON.stringify((await view(attempt.attemptId, lina())).body)).not.toContain(
        "TEMOIN-MODELE-CAHIER",
      );
      expectStatus(
        await world.http({ method: "POST", url: `/api/assignments/${assignmentId}/reveal`, cookie: tutor() }),
        204,
      );
      expect(JSON.stringify((await view(attempt.attemptId, lina())).body)).toContain("TEMOIN-MODELE-CAHIER");
    });
  });

  describe("Images du cahier (R14, R3)", () => {
    it("une image importée est réencodée, référencée par la scène et visible comme la copie (R14, R3)", async () => {
      const attempt = await start();
      const upload = await uploadNotebookImage(world, lina(), attempt.attemptId, await pngImage());
      expectStatus(upload, 201);
      const { mediaId } = upload.body as { mediaId: string };
      expect(mediaId).toMatch(/^nmd_/);
      expectStatus(await saveScene(world, lina(), attempt, [triangle(), imageElement(mediaId)]), 204);
      const url = `/api/notebook-media/${mediaId}`;
      const mine = await world.http({ method: "GET", url, cookie: lina() });
      expect(mine.status).toBe(200);
      expect(mine.headers["content-type"]).toBe("image/webp");
      expect(mine.headers["content-disposition"]).toBe(`inline; filename="${mediaId}.webp"`);
      expect((await world.http({ method: "GET", url, cookie: tutor() })).status).toBe(200);
      // Autre élève, parent non lié, et parent lié avant publication : comme une image inexistante (R2).
      for (const cookie of [family.otherLearner.cookie, family.unlinkedGuardian, family.linkedGuardian]) {
        const res = await world.http({ method: "GET", url, cookie });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: "application.not-found" });
      }
    });

    it("refuse une image qui n'a pas été importée pour cette copie (R14)", async () => {
      const attempt = await start();
      const res = await saveScene(world, lina(), attempt, [
        imageElement("nmd_01920000-0000-7000-8000-000000000001"),
      ]);
      expect(res.status).toBe(422);
    });

    it("refuse un fichier qui n'est pas une image et tout import après le rendu (R14, R6)", async () => {
      const attempt = await start();
      const svg = await uploadNotebookImage(
        world,
        lina(),
        attempt.attemptId,
        Buffer.from("<svg onload=alert(1)></svg>"),
      );
      expect(svg.status).toBe(415);
      await submit(attempt);
      const late = await uploadNotebookImage(world, lina(), attempt.attemptId, await pngImage());
      expect(late.status).toBe(409);
      expect(late.body).toMatchObject({ code: "assessment.attempt-submitted" });
    });
  });

  describe("Calque d'annotation du tuteur (R6)", () => {
    async function submitted(): Promise<LearnerAttempt> {
      const attempt = await start();
      expectStatus(await saveScene(world, lina(), attempt, [triangle()]), 204);
      expectStatus(await submit(attempt), 200);
      return attempt;
    }
    const annotate = (attempt: LearnerAttempt, elements: unknown[]) =>
      world.http({
        method: "PUT",
        url: `/api/grading/attempts/${attempt.attemptId}/annotations/${attempt.questions[0]?.id ?? ""}`,
        cookie: tutor(),
        payload: { elements },
      });

    it("l'empreinte de la copie est identique avant et après annotation (R6)", async () => {
      const attempt = await submitted();
      const sha = async () =>
        (
          (
            await world.http({
              method: "GET",
              url: `/api/grading/attempts/${attempt.attemptId}`,
              cookie: tutor(),
            })
          ).body as {
            answersSha256: string;
          }
        ).answersSha256;
      const before = await sha();
      expectStatus(
        await annotate(attempt, [textElement("n1", "✓", "#2f9e44"), textElement("n2", "✗", "#e03131")]),
        204,
      );
      expectStatus(await annotate(attempt, [textElement("n1", "Très bien", "#e03131")]), 204);
      expect(await sha()).toBe(before);
    });

    it("le calque n'admet ni image ni formule, et ne s'écrit pas sur une copie en brouillon (R6, R14)", async () => {
      const draft = await start();
      const onDraft = await annotate(draft, [textElement("n1", "trop tôt")]);
      expect(onDraft.status).toBe(409);
      await saveScene(world, lina(), draft, [triangle()]);
      await submit(draft);
      const withImage = await annotate(draft, [imageElement("nmd_01920000-0000-7000-8000-000000000001")]);
      expect(withImage.body).toMatchObject({ code: "assessment.invalid-notebook" });
    });

    it("l'élève et son parent voient le calque seulement avec la correction publiée ; ensuite il est figé (R5, R6)", async () => {
      const attempt = await submitted();
      expectStatus(await annotate(attempt, [textElement("n1", "Angle droit mal placé", "#e03131")]), 204);
      const correctionOf = async (cookie: string) =>
        (
          (await view(attempt.attemptId, cookie)).body as {
            correction: { questions: Array<{ annotation: unknown }> } | null;
          }
        ).correction;
      expect(await correctionOf(lina())).toBeNull();
      await world.http({
        method: "POST",
        url: `/api/grading/attempts/${attempt.attemptId}/grades`,
        cookie: tutor(),
        payload: { grades: [{ questionId: attempt.questions[0]?.id, earned: 3 }] },
      });
      expectStatus(
        await world.http({
          method: "POST",
          url: `/api/grading/attempts/${attempt.attemptId}/publish`,
          cookie: tutor(),
        }),
        204,
      );
      const guardian = await loginGuardian(world, "awa@example.org");
      for (const cookie of [lina(), guardian]) {
        expect((await correctionOf(cookie))?.questions[0]?.annotation).toMatchObject({
          elements: [{ text: "Angle droit mal placé" }],
        });
      }
      const after = await annotate(attempt, [textElement("n1", "Corrigé après coup")]);
      expect(after.status).toBe(409);
      await expect(
        world.adminQuery(
          `UPDATE assessment.notebook_annotations SET scene = '{"elements":[]}' WHERE attempt_id = $1`,
          [attempt.attemptId.slice(4)],
        ),
      ).rejects.toThrow(/R6/);
    });
  });
});
