"use server";

import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import { loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";
import { ActionError } from "@/lib/action-result";

/** Toggles watching a card. Returns the new state. */
export async function toggleCardWatchAction(cardId: string) {
  return safeAction(async () => {
    const user = await requireUser();
    const card = await prisma.taskCard.findUnique({
      where: { id: String(cardId ?? "") },
      select: { id: true, column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    await loadBoardAccess(card.column.boardId);
    const key = { cardId_userId: { cardId: card.id, userId: user.id } };
    const existing = await prisma.cardWatcher.findUnique({ where: key });
    if (existing) await prisma.cardWatcher.delete({ where: key });
    else await prisma.cardWatcher.create({ data: { cardId: card.id, userId: user.id } });
    return { watching: !existing };
  });
}

/** Toggles watching a board. Returns the new state. */
export async function toggleBoardWatchAction(boardId: string) {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(boardId ?? "");
    await loadBoardAccess(id);
    const key = { boardId_userId: { boardId: id, userId: user.id } };
    const existing = await prisma.boardWatcher.findUnique({ where: key });
    if (existing) await prisma.boardWatcher.delete({ where: key });
    else await prisma.boardWatcher.create({ data: { boardId: id, userId: user.id } });
    return { watching: !existing };
  });
}
