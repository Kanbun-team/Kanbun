// Recurring cards: creates a card from its template for every active schedule
// whose nextRunAt has passed. Each card is created in the same transaction as
// the update that advances nextRunAt, and that update is conditional on the
// nextRunAt value read before, so a schedule can never fire twice for the
// same slot (even if two runs overlapped). A server that was down for a while
// creates one card per schedule, not one per missed slot.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { publishBoard } from "@/lib/realtime";
import { emitBoardEvent } from "@/server/webhooks";
import { nextOccurrence, toRule } from "@/lib/recurrence";
import { createCardFromTemplate } from "@/server/card-templates";
import { publishRuleRuns } from "@/server/automations";

const BATCH = 100;

export async function runRecurringCards(now: Date = new Date(), db: PrismaClient = prisma): Promise<{ created: number }> {
  const due = await db.cardRecurrence.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: BATCH,
    include: {
      template: true,
      column: { select: { id: true, name: true, boardId: true } },
    },
  });

  const touched = new Set<string>();
  let created = 0;
  for (const r of due) {
    const rule = toRule(r);
    const usable =
      rule && r.template && r.column && r.template.boardId === r.boardId && r.column.boardId === r.boardId;
    if (!usable) {
      // The template or column was deleted (or the row is malformed).
      await db.cardRecurrence.updateMany({ where: { id: r.id, nextRunAt: r.nextRunAt }, data: { active: false } });
      continue;
    }
    const next = nextOccurrence(rule, now);
    const card = await db.$transaction(async (tx) => {
      const claimed = await tx.cardRecurrence.updateMany({
        where: { id: r.id, active: true, nextRunAt: r.nextRunAt },
        data: { nextRunAt: next, lastRunAt: now },
      });
      if (claimed.count === 0) return null;
      return createCardFromTemplate(tx, {
        template: r.template!,
        column: r.column!,
        actorId: r.createdById,
        source: "schedule",
      });
    });
    if (card) {
      created++;
      touched.add(r.boardId);
      emitBoardEvent(r.boardId, "card.created", { cardId: card.id, actorId: r.createdById }, db);
      await publishRuleRuns(card.runs, db);
    }
  }
  for (const boardId of touched) publishBoard(boardId);
  return { created };
}
