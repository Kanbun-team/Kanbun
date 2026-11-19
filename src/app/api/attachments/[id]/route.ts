import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db-local";
import { loadBoardAccess } from "@/server/board-access";
import { contentDisposition, isInlineImage } from "@/lib/attachments";
import { AttachmentNotFoundError, openAttachmentFile } from "@/server/attachment-storage";
import { openThumbnail, THUMB_TYPE, wantsThumbnail } from "@/server/attachment-thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Download or preview an attachment: GET /api/attachments/<id>, with
// `?download=1` to force a download, or `?thumb=1` for the small WebP preview
// of a large image (the original when there is none, see
// attachment-thumbnails.ts). Only raster images are served inline;
// everything else (SVG and HTML included) is a download, and the response is
// sandboxed with nosniff so nothing can run in the app's origin. The file is
// streamed from the configured store (local disk or S3), never redirected to,
// so access checks and headers stay the same for both.

// Types a browser could render as a document if it ever ignored the
// disposition; they are served as opaque bytes.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/pdf)$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const attachment = await prisma.cardAttachment.findUnique({
    where: { id },
    select: {
      fileName: true,
      mimeType: true,
      storageKey: true,
      width: true,
      card: { select: { column: { select: { boardId: true } } } },
    },
  });
  if (!attachment) return new Response("Not found", { status: 404 });
  try {
    await loadBoardAccess(attachment.card.column.boardId);
  } catch {
    // Same answer whether the file exists or not.
    return new Response("Not found", { status: 404 });
  }

  const inline = isInlineImage(attachment.mimeType) && req.nextUrl.searchParams.get("download") !== "1";
  let file: Awaited<ReturnType<typeof openAttachmentFile>> | null = null;
  let type = ACTIVE_TYPES.test(attachment.mimeType) ? "application/octet-stream" : attachment.mimeType;
  if (inline && req.nextUrl.searchParams.get("thumb") === "1" && wantsThumbnail(attachment.mimeType, attachment.width)) {
    file = await openThumbnail(attachment.storageKey);
    if (file) type = THUMB_TYPE;
  }
  if (!file) {
    try {
      file = await openAttachmentFile(attachment.storageKey);
    } catch (err) {
      if (!(err instanceof AttachmentNotFoundError)) console.error("[attachments] download", err);
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response(file.stream, {
    headers: {
      "Content-Type": type,
      ...(file.size !== null ? { "Content-Length": String(file.size) } : {}),
      "Content-Disposition": contentDisposition(attachment.fileName, inline),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
