import { isInlineImage, sniffImageType } from "@/lib/attachments";
import {
  AttachmentNotFoundError,
  attachmentStore,
  thumbnailKey,
  type AttachmentStore,
} from "@/server/attachment-storage";

// Small previews of image attachments, so the card panel does not load a
// 10 MB photo to draw a 200px tile. Made with sharp when an image is uploaded
// and stored next to the original (key + "_thumb") through the same store,
// local disk or S3. Attachments uploaded before thumbnails existed get theirs
// the first time one is asked for. Whenever no thumbnail can be had (sharp is
// missing, the image is broken), the original is served instead.
//
// Only the raster types that are already shown inline get one; GIFs are left
// alone so they keep their animation. Thumbnails are WebP, have no metadata
// (EXIF, GPS) and are rotated upright.

/** Width in pixels: a 3-column tile in the card panel on a 2x screen. */
export const THUMB_WIDTH = 480;
export const THUMB_TYPE = "image/webp";
// Refuse decompression bombs: ~50 megapixels is a large photo (8000x6000).
const MAX_INPUT_PIXELS = 50_000_000;

/** Whether an attachment gets a thumbnail: a safe, non-animated raster image wider than THUMB_WIDTH. */
export function wantsThumbnail(mimeType: string, width: number | null): boolean {
  if (!isInlineImage(mimeType) || mimeType === "image/gif") return false;
  // Unknown width: try anyway, the resize never enlarges.
  return width === null || width > THUMB_WIDTH;
}

type Sharp = typeof import("sharp").default;
let sharpModule: Promise<Sharp | null> | null = null;

// Loaded on first use, so a missing native binary only turns thumbnails off.
function loadSharp(): Promise<Sharp | null> {
  sharpModule ??= import("sharp")
    .then((m) => m.default)
    .catch((err) => {
      console.error("[attachments] sharp is not available, images are shown at full size", err);
      return null;
    });
  return sharpModule;
}

/** A WebP thumbnail of an image, or null when it cannot be made. */
export async function makeThumbnail(bytes: Uint8Array): Promise<Buffer | null> {
  // sharp would also decode SVG, TIFF, HEIF and more: only hand it the bytes
  // of a PNG, JPEG or WebP (by their magic bytes, not by what was declared).
  const sniffed = sniffImageType(bytes);
  if (!sniffed || !wantsThumbnail(sniffed, null)) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch (err) {
    console.error("[attachments] thumbnail", err);
    return null;
  }
}

/** Makes and stores the thumbnail of a freshly uploaded file. Never throws. */
export async function storeThumbnail(
  storageKey: string,
  bytes: Uint8Array,
  store: AttachmentStore = attachmentStore()
): Promise<boolean> {
  const thumb = await makeThumbnail(bytes);
  if (!thumb) return false;
  try {
    await store.save(thumbnailKey(storageKey), thumb);
    return true;
  } catch (err) {
    console.error("[attachments] store thumbnail", err);
    return false;
  }
}

// One generation per key at a time, so two requests for the same missing
// thumbnail do not both resize it and race on the write. Images that could
// not be resized are remembered (per process) so they are not tried again on
// every view.
const pending = new Map<string, Promise<boolean>>();
const failed = new Set<string>();
const MAX_FAILED = 1000;

/**
 * Opens an attachment's thumbnail, making it from the original first when it
 * is missing (attachments from before thumbnails). Null when there is none to
 * be had; the caller then serves the original.
 */
export async function openThumbnail(
  storageKey: string,
  store: AttachmentStore = attachmentStore()
): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null } | null> {
  const key = thumbnailKey(storageKey);
  try {
    return await store.open(key);
  } catch (err) {
    if (!(err instanceof AttachmentNotFoundError)) {
      console.error("[attachments] open thumbnail", err);
      return null;
    }
  }
  if (failed.has(storageKey)) return null;
  let job = pending.get(storageKey);
  if (!job) {
    job = (async () => {
      let original: Buffer;
      try {
        original = await store.read(storageKey);
      } catch (err) {
        if (!(err instanceof AttachmentNotFoundError)) console.error("[attachments] read for thumbnail", err);
        return false;
      }
      const thumb = await makeThumbnail(original);
      if (!thumb) {
        if (failed.size >= MAX_FAILED) failed.clear();
        failed.add(storageKey);
        return false;
      }
      try {
        await store.save(key, thumb);
        return true;
      } catch (err) {
        console.error("[attachments] store thumbnail", err);
        return false;
      }
    })().finally(() => pending.delete(storageKey));
    pending.set(storageKey, job);
  }
  if (!(await job)) return null;
  try {
    return await store.open(key);
  } catch {
    return null;
  }
}
