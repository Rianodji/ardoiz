import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupFamily, type Family } from "./support/families.js";
import {
  lessonContent,
  pngImage,
  setupProgramme,
  unlock,
  uploadImage,
  type Programme,
} from "./support/programme.js";
import { World, type Snapshot } from "./support/world.js";

describe("Programme et contenu de cours (L2)", () => {
  let snapshot: Snapshot;
  let family: Family;
  let programme: Programme;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    programme = await setupProgramme(base, family);
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

  const tutor = () => family.tutor.cookie;

  describe("Référentiel de compétences", () => {
    type Referential = {
      competencies: Array<{
        id: string;
        code: string;
        label: string;
        archivedAt: string | null;
        domainId: string;
      }>;
      domains: Array<{ id: string; prefix: string }>;
    };
    const referential = async (): Promise<Referential> =>
      (await world.http({ method: "GET", url: "/api/referential", cookie: tutor() })).body as Referential;
    const choices = async (): Promise<string[]> =>
      (
        (await world.http({ method: "GET", url: "/api/competencies", cookie: tutor() })).body as {
          competencies: Array<{ code: string }>;
        }
      ).competencies.map((competency) => competency.code);

    it("charge le référentiel validé à la création de l'espace : 33 compétences aux codes stables", async () => {
      const tree = await referential();
      expect(tree.competencies).toHaveLength(33);
      expect(tree.competencies.map((competency) => competency.code)).toContain("MES-01");
    });

    it("recharger le référentiel n'ajoute ni ne modifie rien (idempotent)", async () => {
      const space = await world.adminQuery<{ id: string }>(
        "SELECT id FROM tenancy.tutor_spaces WHERE code = 'dicard'",
      );
      const { fromUuid } = await import("../../src/platform/ids/UuidV7IdGenerator.js");
      expect(await world.curriculum.seedReferential(fromUuid("TutorSpaceId", space[0]?.id ?? ""))).toEqual({
        added: 0,
      });
    });

    it("ajoute une compétence avec le code suivant de son domaine, la renomme sans changer son code", async () => {
      const mes = (await referential()).domains.find((domain) => domain.prefix === "MES");
      const added = await world.http({
        method: "POST",
        url: "/api/competencies",
        cookie: tutor(),
        payload: { domainId: mes?.id, label: "Lire une échelle" },
      });
      expect(added.status).toBe(201);
      const id = (added.body as { id: string }).id;
      expect(
        (
          await world.http({
            method: "PATCH",
            url: `/api/competencies/${id}`,
            cookie: tutor(),
            payload: { label: "Lire et utiliser une échelle" },
          })
        ).status,
      ).toBe(204);
      const competency = (await referential()).competencies.find((candidate) => candidate.id === id);
      expect(competency).toMatchObject({ code: "MES-07", label: "Lire et utiliser une échelle" });
    });

    it("archiver une compétence la retire des choix sans effacer l'historique (jalons L2)", async () => {
      const target = (await referential()).competencies.find((competency) => competency.code === "GEO-09");
      expect(
        (
          await world.http({
            method: "POST",
            url: `/api/competencies/${target?.id ?? ""}/archive`,
            cookie: tutor(),
          })
        ).status,
      ).toBe(204);
      expect(await choices()).not.toContain("GEO-09");
      expect(
        (await referential()).competencies.find((competency) => competency.code === "GEO-09")?.archivedAt,
      ).not.toBeNull();
      const audit = await world.adminQuery(
        "SELECT 1 FROM audit.audit_log WHERE action = 'curriculum.competency-archived'",
      );
      expect(audit).toHaveLength(1);
    });

    it("supprimer une compétence est impossible : ni route, ni privilège, et même le propriétaire est refusé (jalons L2)", async () => {
      const target = (await referential()).competencies[0];
      expect(
        (
          await world.http({
            method: "DELETE",
            url: `/api/competencies/${target?.id ?? ""}`,
            cookie: tutor(),
          })
        ).status,
      ).toBe(404);
      await expect(
        world.adminQuery("DELETE FROM curriculum.competencies WHERE code = 'NUM-01'"),
      ).rejects.toThrow(/ne se supprime jamais/);
      const grants = await world.adminQuery(
        "SELECT 1 FROM information_schema.role_table_grants WHERE grantee = 'ardoiz_user' AND table_name = 'competencies' AND privilege_type = 'DELETE'",
      );
      expect(grants).toHaveLength(0);
    });

    it("le code d'une compétence ne peut pas être modifié par le rôle d'exécution", async () => {
      const grants = await world.adminQuery<{ column_name: string }>(
        "SELECT column_name FROM information_schema.column_privileges WHERE grantee = 'ardoiz_user' AND table_name = 'competencies' AND privilege_type = 'UPDATE'",
      );
      expect(grants.map((grant) => grant.column_name).sort()).toEqual(["archived_at", "label", "position"]);
    });
  });

  describe("Contenu de cours (R4)", () => {
    it("refuse à l'écriture un document hors du schéma fermé, sans rien enregistrer (R4)", async () => {
      const res = await world.http({
        method: "PUT",
        url: `/api/lessons/${programme.lessonId}/content`,
        cookie: tutor(),
        payload: {
          content: { type: "doc", content: [{ type: "paragraph", attrs: { onclick: "alert(1)" } }] },
        },
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "curriculum.invalid-content" });
      const lesson = await world.http({
        method: "GET",
        url: `/api/lessons/${programme.lessonId}/edit`,
        cookie: tutor(),
      });
      expect(JSON.stringify(lesson.body)).not.toContain("onclick");
    });

    it("refuse un document qui cite un média d'un autre cours (R3)", async () => {
      const other = await world.http({
        method: "POST",
        url: "/api/lessons",
        cookie: tutor(),
        payload: { moduleId: programme.moduleId, title: "Autre cours" },
      });
      const otherId = (other.body as { id: string }).id;
      const res = await world.http({
        method: "PUT",
        url: `/api/lessons/${otherId}/content`,
        cookie: tutor(),
        payload: { content: lessonContent(programme.mediaId) },
      });
      expect(res.status).toBe(422);
    });

    it("refuse de publier un cours vide", async () => {
      const empty = await world.http({
        method: "POST",
        url: "/api/lessons",
        cookie: tutor(),
        payload: { moduleId: programme.moduleId, title: "Vide" },
      });
      const res = await world.http({
        method: "POST",
        url: `/api/lessons/${(empty.body as { id: string }).id}/publish`,
        cookie: tutor(),
      });
      expect(res.status).toBe(409);
    });

    it("refuse un corps de plus de 1 Mio (R15)", async () => {
      const huge = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(1_100_000) }] }],
      };
      const res = await world.http({
        method: "PUT",
        url: `/api/lessons/${programme.lessonId}/content`,
        cookie: tutor(),
        payload: { content: huge },
      });
      expect(res.status).toBe(413);
    });
  });

  describe("Import d'images (R14, M13)", () => {
    const upload = (bytes: Buffer) => uploadImage(world, tutor(), programme.lessonId, bytes);
    const readMedia = async (mediaId: string): Promise<Buffer> =>
      (await world.http({ method: "GET", url: `/api/media/${mediaId}`, cookie: tutor() })).body as Buffer;

    it("une photo avec des coordonnées GPS ressort réencodée en WebP, sans aucune métadonnée (R14)", async () => {
      const photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: "orange" } })
        .jpeg()
        .withExif({
          IFD0: { Make: "Téléphone de Lina", Copyright: "Maison" },
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 0/1" },
        })
        .toBuffer();
      expect((await sharp(photo).metadata()).exif).toBeDefined();
      const res = await upload(photo);
      expect(res.status).toBe(201);
      const stored = await readMedia((res.body as { mediaId: string }).mediaId);
      const metadata = await sharp(stored).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(stored.includes(Buffer.from("Maison"))).toBe(false);
    });

    it("refuse un SVG, même renommé (R14)", async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const res = await upload(svg);
      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ code: "curriculum.image-unsupported-type" });
    });

    it("refuse un polyglotte : signature d'image suivie de HTML (R14)", async () => {
      const polyglot = Buffer.concat([
        Buffer.from("GIF89a"),
        Buffer.from("<html><script>alert(document.cookie)</script></html>"),
      ]);
      const res = await upload(polyglot);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "curriculum.image-undecodable" });
    });

    it("rend inoffensive une image valide suivie d'un script : il disparaît au réencodage (R14)", async () => {
      const payload = Buffer.from("<script>alert(1)</script>");
      const res = await upload(Buffer.concat([await pngImage(), payload]));
      expect(res.status).toBe(201);
      expect((await readMedia((res.body as { mediaId: string }).mediaId)).includes(payload)).toBe(false);
    });

    it("refuse une image de 50 mégapixels avant de la décoder (bombe de décompression, R14)", async () => {
      const giant = await sharp({
        create: { width: 10_000, height: 5_000, channels: 3, background: "white" },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const res = await upload(giant);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "curriculum.image-undecodable" });
    });

    it("refuse un fichier de plus de 10 Mo (R14, R15)", async () => {
      const res = await upload(Buffer.concat([await pngImage(), Buffer.alloc(10 * 1024 * 1024)]));
      expect(res.status).toBe(413);
    });

    it("sert le média avec un type fixé, nosniff, en ligne, sous un nom généré (R14)", async () => {
      const res = await world.http({
        method: "GET",
        url: `/api/media/${programme.mediaId}`,
        cookie: tutor(),
      });
      expect(res.status).toBe(200);
      expect(res.headers).toMatchObject({
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="${programme.mediaId}.webp"`,
      });
    });

    it("le média d'un cours non déverrouillé répond 404 à l'élève (R3)", async () => {
      const res = await world.http({
        method: "GET",
        url: `/api/media/${programme.mediaId}`,
        cookie: family.learner.cookie,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Cours terminé et vues élève et parent", () => {
    const completion = (cookie: string) =>
      world.http({ method: "POST", url: `/api/lessons/${programme.lessonId}/completion`, cookie });

    it("un élève ne peut pas terminer un cours qu'il ne peut pas lire (R3)", async () => {
      expect((await completion(family.learner.cookie)).status).toBe(404);
    });

    it("terminer un cours publie « CoursTerminé » dans l'outbox, une seule fois", async () => {
      await unlock(
        world,
        tutor(),
        { kind: "module", id: programme.moduleId },
        { kind: "learner", id: family.learner.id },
      );
      expect((await completion(family.learner.cookie)).status).toBe(204);
      expect((await completion(family.learner.cookie)).status).toBe(204);
      const events = await world.adminQuery<{ type: string; payload: { lessonId: string } }>(
        "SELECT type, payload FROM messaging.outbox",
      );
      expect(events.filter((event) => event.type === "curriculum.lesson-completed")).toHaveLength(1);
      expect(events[0]?.payload.lessonId).toBe(programme.lessonId);
    });

    it("le parent voit ce que son enfant a débloqué et terminé ; un autre parent ne voit rien (R2)", async () => {
      await unlock(
        world,
        tutor(),
        { kind: "lesson", id: programme.lessonId },
        { kind: "learner", id: family.learner.id },
      );
      await completion(family.learner.cookie);
      const mine = await world.http({
        method: "GET",
        url: `/api/learners/${family.learner.id}/programme`,
        cookie: family.linkedGuardian,
      });
      expect(mine.status).toBe(200);
      const lessons = (
        mine.body as {
          subjects: Array<{
            modules: Array<{ lessons: Array<{ title: string; completedAt: string | null }> }>;
          }>;
        }
      ).subjects
        .flatMap((subject) => subject.modules)
        .flatMap((module) => module.lessons);
      expect(lessons).toEqual([
        {
          id: programme.lessonId,
          title: "Convertir des longueurs",
          completedAt: expect.any(String) as string,
        },
      ]);
      const other = await world.http({
        method: "GET",
        url: `/api/learners/${family.learner.id}/programme`,
        cookie: family.unlinkedGuardian,
      });
      expect(other.status).toBe(404);
    });

    it("reverrouiller retire l'accès immédiatement ; le (dé)verrouillage est audité (R3, R12)", async () => {
      const unlockId = await unlock(
        world,
        tutor(),
        { kind: "lesson", id: programme.lessonId },
        { kind: "learner", id: family.learner.id },
      );
      expect(
        (
          await world.http({
            method: "GET",
            url: `/api/lessons/${programme.lessonId}`,
            cookie: family.learner.cookie,
          })
        ).status,
      ).toBe(200);
      expect(
        (await world.http({ method: "DELETE", url: `/api/unlocks/${unlockId}`, cookie: tutor() })).status,
      ).toBe(204);
      expect(
        (
          await world.http({
            method: "GET",
            url: `/api/lessons/${programme.lessonId}`,
            cookie: family.learner.cookie,
          })
        ).status,
      ).toBe(404);
      const audit = await world.adminQuery<{ action: string }>(
        "SELECT action FROM audit.audit_log WHERE action IN ('curriculum.unlocked', 'curriculum.relocked')",
      );
      expect(audit.map((row) => row.action).sort()).toEqual(["curriculum.relocked", "curriculum.unlocked"]);
    });

    it("un groupe ne peut contenir qu'un élève de l'espace (R10)", async () => {
      const res = await world.http({
        method: "PUT",
        url: `/api/groups/${programme.groupId}/members`,
        cookie: tutor(),
        payload: { learnerIds: ["lrn_01920000-0000-7000-8000-000000000000"] },
      });
      expect(res.status).toBe(404);
    });
  });
});
