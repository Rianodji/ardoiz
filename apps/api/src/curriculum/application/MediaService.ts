import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { LessonId, MediaId } from "../../shared-kernel/ids.js";
import { canAuthor } from "./policies.js";
import { authorize, type CurriculumDependencies } from "./support.js";

/**
 * Import d'une image dans un cours (R14) : le tuteur seul ; l'image est réencodée (WebP, sans
 * métadonnées) avant d'être stockée sous un nom généré. Le fichier d'origine n'est jamais conservé.
 */
export class MediaService {
  constructor(private readonly deps: CurriculumDependencies) {}

  async upload(
    actor: Actor,
    lessonId: LessonId,
    bytes: Buffer,
  ): Promise<{ mediaId: MediaId; width: number; height: number }> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.upload-media", lessonId);
    const lessonExists = await this.deps.gateway.inSpace(
      actor.tutorSpaceId,
      async (store) => (await store.lessonById(lessonId)) !== null,
    );
    if (!lessonExists) throw new NotFoundError();
    const image = await this.deps.images.ingest(bytes);
    const mediaId = this.deps.ids.next("MediaId");
    await this.deps.files.save(actor.tutorSpaceId, mediaId, image.webp);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      store.insertMedia({
        id: mediaId,
        lessonId,
        width: image.width,
        height: image.height,
        byteSize: image.webp.length,
        sha256: image.sha256,
        createdAt: this.deps.clock.now(),
      }),
    );
    return { mediaId, width: image.width, height: image.height };
  }
}
