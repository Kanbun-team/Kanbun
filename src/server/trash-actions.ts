"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import { ActionError } from "@/lib/action-result";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";
import { boardSnapshotOwners, restoreTrashItem } from "@/server/trash";
import { publishBoard, publishBoardList } from "@/lib/realtime";

// Who may restore: cards need board membership, columns need board management
// (the same rights it took to delete them), boards need an admin or one of
// the board's owners at the time it was deleted.
export async function restoreTrashAction(trashId: string) {
  return safeAction(async () => {
    const user = await requireUser();
    const item = await prisma.trashItem.findUnique({ where: { id: trashId } });
    if (!item) throw new ActionError("notFound");
    if (item.kind === "board") {
      if (user.role !== "admin" && !boardSnapshotOwners(item.payload).includes(user.id)) {
        throw new ActionError("forbidden");
      }
    } else {
      const board = await prisma.board.findUnique({ where: { id: item.boardId }, select: { id: true } });
      if (!board) throw new ActionError("restoreBoardFirst");
      const access = await loadBoardAccess(item.boardId);
      if (item.kind === "column" && !canManageBoard(access)) throw new ActionError("forbidden");
    }
    const boardId = await restoreTrashItem(item);
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${boardId}`);
    revalidatePath("/trash");
    publishBoard(boardId);
    publishBoardList();
    return { boardId };
  });
}

export async function restoreTrashFormAction(fd: FormData) {
  return restoreTrashAction(String(fd.get("trashId") ?? ""));
}
