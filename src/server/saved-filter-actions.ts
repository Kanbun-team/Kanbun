"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { isFiltering } from "@/lib/board-filters";
import { filtersSchema } from "@/lib/board-filters-schema";
import { publishBoard } from "@/lib/realtime";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";

// Saved filters are named board filters shared with everyone on the board.
// Any member can save one; the creator and board managers can delete it.

const MAX_PER_BOARD = 50;

const createSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  filters: filtersSchema,
});

export async function createSavedFilterAction(input: { boardId: string; name: string; filters: unknown }) {
  return safeAction(async () => {
    const data = createSchema.parse(input);
    if (!isFiltering(data.filters)) throw new ActionError("invalid");
    const access = await loadBoardAccess(data.boardId);
    const count = await prisma.savedFilter.count({ where: { boardId: data.boardId } });
    if (count >= MAX_PER_BOARD) throw new ActionError("invalid");
    const saved = await prisma.savedFilter.create({
      data: {
        boardId: data.boardId,
        name: data.name,
        filters: JSON.stringify(data.filters),
        createdById: access.userId,
      },
      select: { id: true },
    });
    revalidatePath(`/tasks/${data.boardId}`);
    publishBoard(data.boardId);
    return { id: saved.id };
  });
}

export async function deleteSavedFilterAction(input: { id: string }) {
  return safeAction(async () => {
    const { id } = z.object({ id: z.string().min(1) }).parse(input);
    const saved = await prisma.savedFilter.findUnique({ where: { id }, select: { boardId: true, createdById: true } });
    if (!saved) throw new ActionError("notFound");
    const access = await loadBoardAccess(saved.boardId);
    if (saved.createdById !== access.userId && !canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.savedFilter.delete({ where: { id } });
    revalidatePath(`/tasks/${saved.boardId}`);
    publishBoard(saved.boardId);
  });
}
