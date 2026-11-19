import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localStore, newStorageKey, removeAttachmentFiles, thumbnailKey, type AttachmentStore } from "@/server/attachment-storage";
import { makeThumbnail, openThumbnail, storeThumbnail, THUMB_WIDTH, wantsThumbnail } from "@/server/attachment-thumbnails";

// Server-side image previews: made on upload, or on first view for older
// attachments, stored next to the original and removed with it.

async function image(width: number, height: number, format: "png" | "jpeg" | "webp" = "png"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } })
    .toFormat(format)
    .toBuffer();
}

async function text(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

let dir: string;
let store: AttachmentStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kanbun-thumbs-"));
  store = localStore(dir);
});

afterEach(async () => {
  delete process.env.ATTACHMENTS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("which attachments get a thumbnail", () => {
  it("only safe, wide, non-animated raster images", () => {
    expect(wantsThumbnail("image/png", 2000)).toBe(true);
    expect(wantsThumbnail("image/jpeg", THUMB_WIDTH + 1)).toBe(true);
    expect(wantsThumbnail("image/webp", null)).toBe(true);
    expect(wantsThumbnail("image/png", THUMB_WIDTH)).toBe(false);
    expect(wantsThumbnail("image/gif", 2000)).toBe(false);
    expect(wantsThumbnail("image/svg+xml", 2000)).toBe(false);
    expect(wantsThumbnail("application/pdf", null)).toBe(false);
  });
});

describe("making thumbnails", () => {
  it("resizes to THUMB_WIDTH as WebP, keeping the aspect ratio", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const thumb = await makeThumbnail(await image(1600, 1200, format));
      expect(thumb).not.toBeNull();
      const meta = await sharp(thumb!).metadata();
      expect(meta).toMatchObject({ format: "webp", width: THUMB_WIDTH, height: 360 });
    }
  });

  it("never enlarges and drops metadata", async () => {
    const withExif = await sharp(await image(300, 200, "jpeg"))
      .withExif({ IFD0: { Copyright: "secret place" } })
      .toBuffer();
    const thumb = await makeThumbnail(withExif);
    const meta = await sharp(thumb!).metadata();
    expect(meta).toMatchObject({ width: 300, height: 200 });
    expect(meta.exif).toBeUndefined();
  });

  it("gives up on bytes that are not an image", async () => {
    expect(await makeThumbnail(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    const png = await image(800, 600);
    expect(await makeThumbnail(png.subarray(0, 100))).toBeNull();
  });
});

describe("storing and serving thumbnails", () => {
  it("stores the thumbnail next to the original on upload", async () => {
    const key = newStorageKey();
    const bytes = await image(1200, 900);
    await store.save(key, bytes);
    expect(await storeThumbnail(key, bytes, store)).toBe(true);
    expect((await readdir(path.join(dir, key.slice(0, 2)))).sort()).toEqual([key, `${key}_thumb`]);
    const opened = await openThumbnail(key, store);
    expect((await sharp(await text(opened!.stream)).metadata()).width).toBe(THUMB_WIDTH);
  });

  it("makes a missing thumbnail on first view (attachments from before thumbnails)", async () => {
    const key = newStorageKey();
    await store.save(key, await image(1000, 500, "jpeg"));
    // Two views at once: one generation, both get it.
    const [a, b] = await Promise.all([openThumbnail(key, store), openThumbnail(key, store)]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const thumb = await store.read(thumbnailKey(key));
    expect(await sharp(thumb).metadata()).toMatchObject({ format: "webp", width: THUMB_WIDTH, height: 240 });
    await text(a!.stream);
    await text(b!.stream);
  });

  it("returns null (serve the original) when the image cannot be resized or is gone", async () => {
    const broken = newStorageKey();
    await store.save(broken, Buffer.from("not really a png"));
    expect(await openThumbnail(broken, store)).toBeNull();
    expect(await openThumbnail(broken, store)).toBeNull();
    await expect(store.read(thumbnailKey(broken))).rejects.toThrow(/not found/);

    expect(await openThumbnail(newStorageKey(), store)).toBeNull();
  });

  it("removes the thumbnail together with the original", async () => {
    process.env.ATTACHMENTS_DIR = dir;
    const key = newStorageKey();
    const bytes = await image(900, 900);
    await store.save(key, bytes);
    await storeThumbnail(key, bytes, store);
    await removeAttachmentFiles([key]);
    expect(await readdir(path.join(dir, key.slice(0, 2)))).toEqual([]);
  });
});
