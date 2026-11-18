"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";

const pinSchema = z.object({
  boardId: z.string().min(1),
  pinned: z.boolean(),
});

/** Pins or unpins a board for the current user (only boards they can open). */
export async function setBoardPinAction(input: { boardId: string; pinned: boolean }) {
  return safeAction(async () => {
    const data = pinSchema.parse(input);
    const access = await loadBoardAccess(data.boardId);
    const key = { userId: access.userId, boardId: data.boardId };
    if (data.pinned) {
      await prisma.boardPin.upsert({ where: { userId_boardId: key }, create: key, update: {} });
    } else {
      await prisma.boardPin.deleteMany({ where: key });
    }
    revalidatePath("/tasks");
    return { pinned: data.pinned };
  });
}
