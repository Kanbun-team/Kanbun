// Pure helpers for card attachments: file names, the Content-Disposition
// header, which types may be shown inline, and image sniffing. Client-safe
// (no Node APIs); disk access lives in src/server/attachment-storage.ts.

/** Raster image types the browser may render inline. SVG is never inline (it can run script). */
export const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export function isInlineImage(mimeType: string): boolean {
  return (INLINE_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

const MAX_NAME = 200;

/**
 * The name shown and offered on download. Drops any directory part (a
 * browser may send "C:\\fakepath\\x.png"), control and bidi override
 * characters, and trims to 200 characters while keeping the extension.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return "file";
  if (cleaned.length <= MAX_NAME) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX_NAME - ext.length) + ext;
}

/** RFC 5987 encoding for filename*: everything except attr-char is percent-encoded. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Content-Disposition with an ASCII fallback `filename` (quotes, backslashes
 * and non-ASCII replaced) and the exact name in `filename*` (RFC 6266).
 */
export function contentDisposition(fileName: string, inline: boolean): string {
  const name = sanitizeFileName(fileName);
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/;

/**
 * The type to store: a sniffed raster image type wins; otherwise the type the
 * browser sent, unless it is malformed or claims to be an inline-safe image
 * (bytes that are not really an image must never be served inline).
 */
export function resolveMimeType(declared: string, sniffed: string | null): string {
  if (sniffed) return sniffed;
  const type = declared.split(";")[0].trim().toLowerCase();
  if (!MIME_RE.test(type) || isInlineImage(type)) return "application/octet-stream";
  return type;
}

/** Detects PNG, JPEG, GIF and WebP from their magic bytes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && ascii(b, 0, 6).match(/^GIF8[79]a$/)) return "image/gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

function ascii(b: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...b.subarray(start, start + length));
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

/** Pixel size of a PNG, JPEG, GIF or WebP, or null when it cannot be read. */
export function imageSize(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const b = bytes;
  let size: { width: number; height: number } | null = null;
  if (type === "image/png" && b.length >= 24) {
    size = { width: u32be(b, 16), height: u32be(b, 20) };
  } else if (type === "image/gif" && b.length >= 10) {
    size = { width: u16le(b, 6), height: u16le(b, 8) };
  } else if (type === "image/webp" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") size = { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    else if (chunk === "VP8 ") size = { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    else if (chunk === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  } else if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      const length = u16be(b, i + 2);
      // Start-of-frame markers (C0 to CF except C4, C8 and CC) carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        size = { width: u16be(b, i + 7), height: u16be(b, i + 5) };
        break;
      }
      i += 2 + length;
    }
  }
  if (!size || size.width <= 0 || size.height <= 0 || size.width > 100_000 || size.height > 100_000) return null;
  return size;
}

/** "512 B", "14 KB", "2.4 MB" in the user's locale. */
export function formatBytes(bytes: number, intlLocale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
