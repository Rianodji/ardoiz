import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import type { TutorSpaceId } from "../../shared-kernel/ids.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Fichiers sur le volume (ADR-0008, `ardoiz_files`) : `<espace>/<média>.webp`. Le nom est généré à
 * partir d'identifiants validés, jamais fourni par l'utilisateur (R14) ; un fichier n'est jamais
 * réécrit. Les fichiers ne sont servis que par des routes autorisées (R3), par exemple `/api/media/:id`.
 */
export class LocalFileStorage {
  constructor(private readonly root: string) {}

  async save(tutorSpaceId: TutorSpaceId, mediaId: string, bytes: Buffer): Promise<void> {
    const directory = join(this.root, this.#safe(toUuid(tutorSpaceId)));
    await mkdir(directory, { recursive: true, mode: 0o750 });
    await writeFile(join(directory, `${this.#safe(toUuid(mediaId))}.webp`), bytes, {
      flag: "wx",
      mode: 0o640,
    });
  }

  read(tutorSpaceId: TutorSpaceId, mediaId: string): Promise<Buffer> {
    return readFile(join(this.root, this.#safe(toUuid(tutorSpaceId)), `${this.#safe(toUuid(mediaId))}.webp`));
  }

  #safe(segment: string): string {
    if (!UUID.test(segment)) throw new Error("Identifiant de fichier invalide.");
    return segment;
  }
}
