import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  formatBytes,
  imageSize,
  isInlineImage,
  resolveMimeType,
  sanitizeFileName,
  sniffImageType,
} from "@/lib/attachments";
import {
  attachmentsDirFrom,
  isStorageKey,
  maxAttachmentBytesFrom,
  newStorageKey,
  storagePathIn,
  thumbnailKey,
} from "@/server/attachment-storage";
import { snapshotStorageKeys } from "@/server/trash";

const PNG_1x2 = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000002080600000099cd8c2a0000000d49444154789c63f8cfc0f01f00050001ff0e7fc4c80000000049454e44ae426082",
    "hex"
  )
);

describe("file names", () => {
  it("drops directories, control and bidi characters", () => {
    expect(sanitizeFileName("C:\\fakepath\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a\u0000b\u202ecod.exe")).toBe("abcod.exe");
    expect(sanitizeFileName("  ...hidden  ")).toBe("hidden");
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("///")).toBe("file");
  });

  it("keeps the extension when trimming long names", () => {
    const name = sanitizeFileName("x".repeat(300) + ".png");
    expect(name.length).toBe(200);
    expect(name.endsWith(".png")).toBe(true);
  });
});

describe("content disposition", () => {
  it("uses inline only when asked and encodes the name both ways", () => {
    expect(contentDisposition("photo.png", true)).toBe(`inline; filename="photo.png"; filename*=UTF-8''photo.png`);
    expect(contentDisposition("Zażółć gęślą.txt", false)).toBe(
      `attachment; filename="Za____ g__l_.txt"; filename*=UTF-8''Za%C5%BC%C3%B3%C5%82%C4%87%20g%C4%99%C5%9Bl%C4%85.txt`
    );
  });

  it("cannot be broken out of with quotes or separators", () => {
    const header = contentDisposition('a"; filename=evil.html; x=".txt', false);
    expect(header.startsWith('attachment; filename="a_; filename=evil.html; x=_.txt"; ')).toBe(true);
    expect(header).toContain("filename*=UTF-8''a%22%3B%20filename%3Devil.html%3B%20x%3D%22.txt");
    expect(contentDisposition("it's (1).txt", false)).toContain("filename*=UTF-8''it%27s%20%281%29.txt");
    expect(contentDisposition("100%.txt", false)).toContain('filename="100_.txt"');
  });
});

describe("types", () => {
  it("serves only raster images inline", () => {
    expect(isInlineImage("image/png")).toBe(true);
    expect(isInlineImage("image/webp")).toBe(true);
    expect(isInlineImage("image/svg+xml")).toBe(false);
    expect(isInlineImage("text/html")).toBe(false);
  });

  it("trusts sniffed images and never a claimed image", () => {
    expect(resolveMimeType("application/octet-stream", "image/png")).toBe("image/png");
    expect(resolveMimeType("image/png", null)).toBe("application/octet-stream");
    expect(resolveMimeType("text/plain;charset=utf-8", null)).toBe("text/plain");
    expect(resolveMimeType("image/svg+xml", null)).toBe("image/svg+xml");
    expect(resolveMimeType("not a type", null)).toBe("application/octet-stream");
    expect(resolveMimeType("", null)).toBe("application/octet-stream");
  });

  it("sniffs magic bytes and reads image sizes", () => {
    expect(sniffImageType(PNG_1x2)).toBe("image/png");
    expect(imageSize(PNG_1x2, "image/png")).toEqual({ width: 1, height: 2 });
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns=...>"))).toBeNull();
    const gif = Uint8Array.from([...new TextEncoder().encode("GIF89a"), 3, 0, 5, 0, 0, 0, 0]);
    expect(sniffImageType(gif)).toBe("image/gif");
    expect(imageSize(gif, "image/gif")).toEqual({ width: 3, height: 5 });
    // JPEG: SOI, an APP0 segment, then SOF0 with height 7 and width 9.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 7, 0, 9, 3, 0, 0, 0]);
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(imageSize(jpeg, "image/jpeg")).toEqual({ width: 9, height: 7 });
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatBytes(512, "en-GB")).toBe("512 B");
    expect(formatBytes(1536, "en-GB")).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024, "en-GB")).toBe("25 MB");
    expect(formatBytes(1536, "de-DE")).toBe("1,5 KB");
  });
});

describe("storage", () => {
  const cwd = "/app";

  it("puts attachments next to the SQLite file", () => {
    expect(attachmentsDirFrom({ DATABASE_URL: "file:/data/kanbun.db" }, cwd)).toBe("/data/attachments");
    expect(attachmentsDirFrom({ DATABASE_URL: "file:./dev.db" }, cwd)).toBe(path.resolve("/app/prisma/attachments"));
    expect(attachmentsDirFrom({ DATABASE_URL: "file:../data/x.db?connection_limit=1" }, cwd)).toBe(
      path.resolve("/app/data/attachments")
    );
    expect(attachmentsDirFrom({}, cwd)).toBe(path.resolve("/app/prisma/attachments"));
  });

  it("honours ATTACHMENTS_DIR", () => {
    expect(attachmentsDirFrom({ ATTACHMENTS_DIR: "/srv/files", DATABASE_URL: "file:/data/k.db" }, cwd)).toBe("/srv/files");
    expect(attachmentsDirFrom({ ATTACHMENTS_DIR: "uploads" }, cwd)).toBe(path.resolve("/app/uploads"));
  });

  it("reads the size limit", () => {
    expect(maxAttachmentBytesFrom({})).toBe(10 * 1024 * 1024);
    expect(maxAttachmentBytesFrom({ ATTACHMENT_MAX_MB: "25" })).toBe(25 * 1024 * 1024);
    expect(maxAttachmentBytesFrom({ ATTACHMENT_MAX_MB: "0" })).toBe(10 * 1024 * 1024);
    expect(maxAttachmentBytesFrom({ ATTACHMENT_MAX_MB: "abc" })).toBe(10 * 1024 * 1024);
  });

  it("only maps random keys to paths inside the directory", () => {
    const key = newStorageKey();
    expect(isStorageKey(key)).toBe(true);
    expect(newStorageKey()).not.toBe(key);
    expect(storagePathIn("/data/attachments", key)).toBe(path.join("/data/attachments", key.slice(0, 2), key));
    for (const bad of ["../../etc/passwd", "", "ABCDEF".repeat(6), "a".repeat(31), `${"a".repeat(32)}/x`, `${"a".repeat(32)}_x`]) {
      expect(() => storagePathIn("/data/attachments", bad)).toThrow();
    }
    // A thumbnail sits next to its original; it is never a key of its own.
    expect(thumbnailKey(key)).toBe(`${key}_thumb`);
    expect(storagePathIn("/data/attachments", thumbnailKey(key))).toBe(path.join("/data/attachments", key.slice(0, 2), `${key}_thumb`));
    expect(isStorageKey(thumbnailKey(key))).toBe(false);
    expect(() => thumbnailKey(thumbnailKey(key))).toThrow();
  });

  it("finds the files held by trash snapshots", () => {
    const card = (keys: string[]) => ({ attachments: keys.map((storageKey) => ({ storageKey })) });
    expect(snapshotStorageKeys("card", JSON.stringify(card(["k1", "k2"])))).toEqual(["k1", "k2"]);
    expect(snapshotStorageKeys("card", JSON.stringify({}))).toEqual([]);
    expect(snapshotStorageKeys("column", JSON.stringify({ cards: [card(["a"]), card([])] }))).toEqual(["a"]);
    expect(
      snapshotStorageKeys("board", JSON.stringify({ columns: [{ cards: [card(["b"])] }, { cards: [card(["c"])] }] }))
    ).toEqual(["b", "c"]);
    expect(snapshotStorageKeys("card", "not json")).toEqual([]);
  });
});
