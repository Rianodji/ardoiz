import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { SerialQueue } from "./SerialQueue.js";
import { DomainError } from "../../shared-kernel/DomainError.js";

/** Image refusée à l'import (R14) : le code dit pourquoi, jamais le contenu reçu. */
export class RejectedImageError extends DomainError {
  constructor(readonly code: `media.image-${string}`) {
    super(`Image refusée (${code}).`);
  }
}

export interface IngestedImage {
  readonly webp: Buffer;
  readonly width: number;
  readonly height: number;
  /** Empreinte SHA-256 du fichier réencodé. */
  readonly sha256: string;
}

/** Bornes de R14 : 10 Mo et 40 mégapixels à l'entrée ; côté le plus long ramené à 2 048 px à la sortie. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_OUTPUT_DIMENSION = 2_048;

type Sniffed = "png" | "jpeg" | "gif" | "webp";

/**
 * Type reconnu par les OCTETS MAGIQUES, jamais par le nom du fichier ni l'en-tête Content-Type
 * envoyés par le client (R14, M13). Tout le reste est refusé — SVG compris, puisqu'il peut porter du script.
 */
export function sniffImage(bytes: Buffer): Sniffed | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const head = bytes.subarray(0, 6).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") return "gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Import d'image (R14, M13) : type vérifié par signature, taille et nombre de pixels bornés AVANT le
 * décodage (bombe de décompression), orientation EXIF appliquée, puis réencodage en WebP SANS aucune
 * métadonnée (coordonnées GPS d'une photo prise chez l'enfant, appareil, date). Tout fichier que la
 * bibliothèque ne décode pas proprement — polyglotte image/HTML compris — est refusé.
 */
export class SharpImageIngestion {
  constructor(private readonly queue = new SerialQueue()) {
    // Mémoire bornée dans un conteneur de 512 Mo (verdict L2, S-3) : un seul fil de libvips, pas de cache.
    sharp.concurrency(1);
    sharp.cache(false);
  }

  /** Un seul import à la fois ; au-delà de 30 s d'attente : 503 avec Retry-After. */
  ingest(bytes: Buffer): Promise<IngestedImage> {
    return this.queue.run(() => this.#ingest(bytes));
  }

  async #ingest(bytes: Buffer): Promise<IngestedImage> {
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
      throw new RejectedImageError("media.image-too-large");
    const sniffed = sniffImage(bytes);
    if (sniffed === null) throw new RejectedImageError("media.image-unsupported-type");

    let metadata: Metadata;
    try {
      metadata = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).metadata();
    } catch {
      throw new RejectedImageError("media.image-undecodable");
    }
    const { width, height } = metadata;
    if (width * height > MAX_IMAGE_PIXELS) throw new RejectedImageError("media.image-too-many-pixels");
    // Le contenu doit être du type annoncé par sa signature : sinon c'est un fichier déguisé.
    if (metadata.format !== sniffed) throw new RejectedImageError("media.image-unsupported-type");

    try {
      const { data, info } = await sharp(bytes, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: "error",
        animated: false,
      })
        .rotate()
        .resize({
          width: MAX_OUTPUT_DIMENSION,
          height: MAX_OUTPUT_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      return {
        webp: data,
        width: info.width,
        height: info.height,
        sha256: createHash("sha256").update(data).digest("hex"),
      };
    } catch {
      throw new RejectedImageError("media.image-undecodable");
    }
  }
}
