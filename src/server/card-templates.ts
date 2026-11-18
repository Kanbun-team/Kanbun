// Server-only helpers shared by the template actions and the recurring-cards
// job. Not a "use server" module: nothing here is callable from the client.

import type { CardTemplate, Prisma, PrismaClient } from "@prisma/client";
import { logActivity } from "@/server/activity";
import { parseStringArray } from "@/lib/card-templates";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Creates a card at the bottom of `column` with the template's title,
 * description, priority, tags (those still on the board) and checklist.
 * Run it inside a transaction so the card and its history land together.
 */
export async function createCardFromTemplate(
  tx: Db,
  {
    template,
    column,
    actorId,
    source,
  }: {
    template: Pick<CardTemplate, "id" | "boardId" | "name" | "title" | "description" | "priority" | "tagIds" | "checklist">;
    column: { id: string; name: string; boardId: string };
    actorId: string | null;
    source: "template" | "schedule";
  }
): Promise<{ id: string }> {
  const wantedTags = parseStringArray(template.tagIds);
  const tags = wantedTags.length
    ? await tx.boardTag.findMany({ where: { id: { in: wantedTags }, boardId: column.boardId }, select: { id: true } })
    : [];
  const checklist = parseStringArray(template.checklist);
  const last = await tx.taskCard.findFirst({
    where: { columnId: column.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const card = await tx.taskCard.create({
    data: {
      columnId: column.id,
      title: template.title,
      description: template.description,
      priority: template.priority,
      position: (last?.position ?? -1) + 1,
      createdById: actorId,
      tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
      subtasks: { create: checklist.map((title, position) => ({ title, position })) },
    },
    select: { id: true, title: true },
  });
  await tx.taskCardMoveEvent.create({
    data: { cardId: card.id, cardTitle: card.title, boardId: column.boardId, toColumnName: column.name, userId: actorId },
  });
  await logActivity(
    {
      cardId: card.id,
      boardId: column.boardId,
      actorId,
      type: source === "schedule" ? "createdBySchedule" : "createdFromTemplate",
      data: { column: column.name, template: template.name },
    },
    tx
  );
  return { id: card.id };
}
