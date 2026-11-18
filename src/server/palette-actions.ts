"use server";

import { z } from "zod";
import { prisma } from "@/lib/db-local";
import { ActionError, type ActionResult } from "@/lib/action-result";
import { loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";

// What the command palette needs to offer card and board actions (move,
// assign to me, priority, new card). The mutations themselves go through the
// regular card actions in tasks-actions.ts.

export interface PaletteColumn {
  id: string;
  name: string;
}

export interface PaletteBoard {
  id: string;
  name: string;
  columns: PaletteColumn[];
}

export interface PaletteCard {
  id: string;
  title: string;
  boardId: string;
  columnId: string;
  priority: string;
  /** The signed-in user, for "Assign to me". */
  meId: string;
  assignedToMe: boolean;
  /** Only board members can be assigned (an admin may not be one). */
  canAssignMe: boolean;
  board: PaletteBoard;
}

const idSchema = z.string().min(1).max(64);

async function boardWithColumns(boardId: string): Promise<PaletteBoard> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, name: true, columns: { orderBy: { position: "asc" }, select: { id: true, name: true } } },
  });
  if (!board) throw new ActionError("notFound");
  return board;
}

export async function paletteBoardAction(boardId: string): Promise<ActionResult<PaletteBoard>> {
  return safeAction(async () => {
    const id = idSchema.parse(boardId);
    await loadBoardAccess(id);
    return boardWithColumns(id);
  });
}

export async function paletteCardAction(cardId: string): Promise<ActionResult<PaletteCard>> {
  return safeAction(async () => {
    const id = idSchema.parse(cardId);
    const card = await prisma.taskCard.findUnique({
      where: { id },
      select: { id: true, title: true, columnId: true, priority: true, column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    const access = await loadBoardAccess(card.column.boardId);
    const [board, mine, member] = await Promise.all([
      boardWithColumns(card.column.boardId),
      prisma.taskCardAssignee.findUnique({
        where: { cardId_userId: { cardId: id, userId: access.userId } },
        select: { userId: true },
      }),
      prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId: card.column.boardId, userId: access.userId } },
        select: { userId: true },
      }),
    ]);
    return {
      id: card.id,
      title: card.title,
      boardId: card.column.boardId,
      columnId: card.columnId,
      priority: card.priority,
      meId: access.userId,
      assignedToMe: !!mine,
      canAssignMe: !!mine || !!member,
      board,
    };
  });
}
