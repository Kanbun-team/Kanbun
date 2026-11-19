import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { loadBoardAccess } from "@/server/board-access";
import { logActivity } from "@/server/activity";
import { publishBoard } from "@/lib/realtime";
import { imageSize, resolveMimeType, sanitizeFileName, sniffImageType } from "@/lib/attachments";
import {
  maxAttachmentBytes,
  newStorageKey,
  removeAttachmentFiles,
  saveAttachmentFile,
} from "@/server/attachment-storage";
import { storeThumbnail, wantsThumbnail } from "@/server/attachment-thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upload one file to a card: POST /api/attachments?cardId=... with a
// multipart body holding `file`. A route handler rather than a server action
// because server action bodies are capped at 2 MB. This path is left out of
// the proxy (src/proxy.ts) so the body is not buffered there; access is
// checked here before the body is read.

const STATUS: Record<string, number> = { unauthorized: 401, forbidden: 403, notFound: 404, invalid: 400 };

function fail(error: string, status = STATUS[error] ?? 500) {
  return Response.json({ ok: false, error }, { status });
}

/** Same-origin check, like the one Next.js applies to server actions. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("forbidden");
  if (!(await auth())?.user?.id) return fail("unauthorized");
  const cardId = req.nextUrl.searchParams.get("cardId") ?? "";
  if (!cardId) return fail("invalid");
  const card = await prisma.taskCard.findUnique({
    where: { id: cardId },
    select: { id: true, column: { select: { boardId: true } } },
  });
  if (!card) return fail("notFound");
  const boardId = card.column.boardId;
  let access;
  try {
    access = await loadBoardAccess(boardId);
  } catch (err) {
    return fail(err instanceof ActionError ? err.code : "unknown");
  }

  const max = maxAttachmentBytes();
  // Multipart framing adds a little; anything far beyond the limit is refused unread.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max + 64 * 1024) return fail("tooLarge", 413);

  // The declared length can be missing (chunked uploads) or wrong, so the body
  // is also counted while it is read and the upload stops once it is too big.
  const limit = max + 64 * 1024;
  let received = 0;
  const body = req.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) controller.error(new Error("tooLarge"));
        else controller.enqueue(chunk);
      },
    })
  );
  let file: FormDataEntryValue | null;
  try {
    const capped = new Request(req.url, { method: "POST", headers: req.headers, body, duplex: "half" } as RequestInit);
    file = (await capped.formData()).get("file");
  } catch {
    return received > limit ? fail("tooLarge", 413) : fail("invalid");
  }
  if (!file || typeof file === "string") return fail("invalid");
  if (file.size === 0) return fail("empty", 400);
  if (file.size > max) return fail("tooLarge", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  const mimeType = resolveMimeType(file.type, sniffed);
  const dims = sniffed ? imageSize(bytes, sniffed) : null;
  const fileName = sanitizeFileName(file.name);
  const storageKey = newStorageKey();

  try {
    await saveAttachmentFile(storageKey, bytes);
  } catch (err) {
    // Disk full, or the object storage is unreachable or refuses the credentials.
    console.error("[attachments] store", err);
    return fail("unknown", 503);
  }
  // A small preview for the card panel. Best effort: without it the original
  // is shown, and the download route tries again later.
  if (wantsThumbnail(mimeType, dims?.width ?? null)) await storeThumbnail(storageKey, bytes);
  let attachment;
  try {
    attachment = await prisma.$transaction(async (tx) => {
      const row = await tx.cardAttachment.create({
        data: {
          cardId,
          uploaderId: access.userId,
          fileName,
          mimeType,
          size: bytes.byteLength,
          storageKey,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        },
        select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true },
      });
      await logActivity(
        { cardId, boardId, actorId: access.userId, type: "attachmentAdded", data: { name: fileName } },
        tx
      );
      return row;
    });
  } catch (err) {
    // The card was deleted meanwhile, or the database failed: drop the orphan file (and thumbnail).
    await removeAttachmentFiles([storageKey]);
    console.error("[attachments] upload", err);
    return fail("notFound");
  }

  revalidatePath(`/tasks/${boardId}`);
  revalidatePath(`/tasks/${boardId}/cards/${cardId}`);
  publishBoard(boardId);
  return Response.json({ ok: true, attachment }, { status: 201 });
}
