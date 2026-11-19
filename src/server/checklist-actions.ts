"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { loadBoardAccess } from "@/server/board-access";
import { safeAction } from "@/server/safe-action";
import { logActivity } from "@/server/activity";
import { publishBoard } from "@/lib/realtime";
import { emitBoardEvent } from "@/server/webhooks";
import { requireUser } from "@/auth";
import { notifySubtaskAssigned } from "@/server/watchers";

// Checklists 2.0: per-item assignee and due date, reordering and turning an
// item into a card of its own. Adding, ticking, renaming and deleting items
// live with the other card actions in tasks-actions.ts.

async function loadSubtask(subtaskId: string) {
  const sub = await prisma.taskSubtask.findUnique({
    where: { id: subtaskId },
    select: {
      id: true,
      title: true,
      cardId: true,
      assigneeId: true,
      dueDate: true,
      card: { select: { id: true, position: true, columnId: true, column: { select: { boardId: true, name: true } } } },
    },
  });
  if (!sub) throw new ActionError("notFound");
  const access = await loadBoardAccess(sub.card.column.boardId);
  return { sub, access, boardId: sub.card.column.boardId };
}

function refresh(boardId: string, cardId: string) {
  revalidatePath(`/tasks/${boardId}`);
  revalidatePath(`/tasks/${boardId}/cards/${cardId}`);
  revalidatePath("/tasks/me");
  publishBoard(boardId);
}

async function isActiveMember(boardId: string, userId: string) {
  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { user: { select: { deactivatedAt: true } } },
  });
  return !!member && !member.user.deactivatedAt;
}

const assigneeSchema = z.object({ subtaskId: z.string().min(1), userId: z.string().min(1).nullable() });

/** Assign a checklist item to a board member, or clear it (userId null). */
export async function setSubtaskAssigneeAction(input: { subtaskId: string; userId: string | null }) {
  return safeAction(async () => {
    const data = assigneeSchema.parse(input);
    const { sub, boardId } = await loadSubtask(data.subtaskId);
    // Only board members, so an item cannot be used to reach arbitrary users.
    if (data.userId && !(await isActiveMember(boardId, data.userId))) throw new ActionError("forbidden");
    await prisma.taskSubtask.update({ where: { id: sub.id }, data: { assigneeId: data.userId } });
    if (data.userId && data.userId !== sub.assigneeId) {
      const user = await requireUser();
      const card = await prisma.taskCard.findUnique({ where: { id: sub.cardId }, select: { title: true } });
      // Never to the person assigning themselves (dispatch skips the actor).
      await notifySubtaskAssigned({
        recipientId: data.userId,
        item: sub.title,
        cardId: sub.cardId,
        cardTitle: card?.title ?? "",
        boardId,
        actorId: user.id,
        actorName: user.displayName ?? user.username,
      });
    }
    refresh(boardId, sub.cardId);
  });
}

const dueSchema = z.object({
  subtaskId: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/** Due date as a calendar date "YYYY-MM-DD" (stored as UTC midnight), or null. */
export async function setSubtaskDueAction(input: { subtaskId: string; dueDate: string | null }) {
  return safeAction(async () => {
    const data = dueSchema.parse(input);
    const due = data.dueDate ? new Date(`${data.dueDate}T00:00:00.000Z`) : null;
    if (due && Number.isNaN(due.getTime())) throw new ActionError("invalid");
    const { sub, boardId } = await loadSubtask(data.subtaskId);
    await prisma.taskSubtask.update({ where: { id: sub.id }, data: { dueDate: due } });
    refresh(boardId, sub.cardId);
  });
}

const moveSchema = z.object({ subtaskId: z.string().min(1), position: z.number().int().min(0) });

/** Move an item to `position` (0-based) in its checklist. */
export async function moveSubtaskAction(input: { subtaskId: string; position: number }) {
  return safeAction(async () => {
    const data = moveSchema.parse(input);
    const { sub, boardId } = await loadSubtask(data.subtaskId);
    await prisma.$transaction(async (tx) => {
      const items = await tx.taskSubtask.findMany({
        where: { cardId: sub.cardId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const ids = items.map((i) => i.id).filter((id) => id !== sub.id);
      const at = Math.min(data.position, ids.length);
      const order = [...ids.slice(0, at), sub.id, ...ids.slice(at)];
      await Promise.all(order.map((id, position) => tx.taskSubtask.update({ where: { id }, data: { position } })));
    });
    refresh(boardId, sub.cardId);
  });
}

/**
 * Turns a checklist item into a card right below its parent, in the same
 * column, keeping the title, the assignee (if still a member) and the due
 * date as the deadline. The item is removed from the checklist.
 */
export async function convertSubtaskToCardAction(subtaskId: string) {
  return safeAction(async () => {
    const { sub, access, boardId } = await loadSubtask(z.string().min(1).parse(subtaskId));
    const assigneeId = sub.assigneeId && (await isActiveMember(boardId, sub.assigneeId)) ? sub.assigneeId : null;
    const parent = sub.card;
    const card = await prisma.$transaction(async (tx) => {
      await tx.taskCard.updateMany({
        where: { columnId: parent.columnId, position: { gt: parent.position } },
        data: { position: { increment: 1 } },
      });
      const created = await tx.taskCard.create({
        data: {
          columnId: parent.columnId,
          title: sub.title,
          position: parent.position + 1,
          deadline: sub.dueDate,
          createdById: access.userId,
          assignees: assigneeId ? { create: [{ userId: assigneeId }] } : undefined,
        },
        select: { id: true, title: true },
      });
      await tx.taskCardMoveEvent.create({
        data: {
          cardId: created.id,
          cardTitle: created.title,
          boardId,
          toColumnName: parent.column.name,
          userId: access.userId,
        },
      });
      await tx.taskSubtask.delete({ where: { id: sub.id } });
      await logActivity(
        [
          { cardId: created.id, boardId, actorId: access.userId, type: "created", data: { column: parent.column.name, columnId: parent.columnId } },
          { cardId: parent.id, boardId, actorId: access.userId, type: "subtaskConverted", data: { title: sub.title } },
        ],
        tx
      );
      return created;
    });
    refresh(boardId, parent.id);
    emitBoardEvent(boardId, "card.created", { cardId: card.id, actorId: access.userId });
    return { cardId: card.id, boardId };
  });
}
