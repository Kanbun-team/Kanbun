"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";
import { logActivity } from "@/server/activity";
import { publishBoard } from "@/lib/realtime";
import { removeAttachmentFiles } from "@/server/attachment-storage";

// Uploads go through the route handler in src/app/api/attachments (server
// action bodies are capped at 2 MB); deleting is a plain action.

/** The uploader or a board manager may delete; the row and the file both go. */
export async function deleteAttachmentAction(formData: FormData) {
  return safeAction(async () => {
    const attachmentId = String(formData.get("attachmentId") ?? "");
    const attachment = await prisma.cardAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        cardId: true,
        fileName: true,
        storageKey: true,
        uploaderId: true,
        card: { select: { column: { select: { boardId: true } } } },
      },
    });
    if (!attachment) throw new ActionError("notFound");
    const boardId = attachment.card.column.boardId;
    const access = await loadBoardAccess(boardId);
    if (attachment.uploaderId !== access.userId && !canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.$transaction(async (tx) => {
      await tx.cardAttachment.delete({ where: { id: attachmentId } });
      await logActivity(
        {
          cardId: attachment.cardId,
          boardId,
          actorId: access.userId,
          type: "attachmentRemoved",
          data: { name: attachment.fileName },
        },
        tx
      );
    });
    await removeAttachmentFiles([attachment.storageKey]);
    revalidatePath(`/tasks/${boardId}`);
    revalidatePath(`/tasks/${boardId}/cards/${attachment.cardId}`);
    publishBoard(boardId);
  });
}
