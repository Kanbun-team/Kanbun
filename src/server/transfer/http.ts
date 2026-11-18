import type { NextRequest } from "next/server";

// Shared bits of the import, export and backup route handlers.

/** Import size limit in bytes from IMPORT_MAX_MB (default 20). */
export function maxImportBytes(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.IMPORT_MAX_MB);
  return Math.round((Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024);
}

export function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error, ...extra }, { status });
}

const STATUS: Record<string, number> = { unauthorized: 401, forbidden: 403, notFound: 404, invalid: 400 };
export const statusOf = (code: string) => STATUS[code] ?? 500;

/** Same-origin check, like the one Next.js applies to server actions. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Reads the request body as text, giving up as soon as it passes `max`
 * bytes, so an oversized upload is never held in memory. Null when too large.
 */
export async function readTextLimited(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Headers for a file download. The name is ASCII-only by construction. */
export function downloadHeaders(fileName: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.\-]/g, "_")}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
