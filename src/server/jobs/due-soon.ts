// Job: "deadline approaching" notifications. Cards due today or tomorrow
// (see isDueSoon) that are not done (not in the board's last column) notify
// their assignees and watchers once per deadline value. DueSoonNotice keeps
// the deadline that was announced, so a changed deadline is announced again.

import { prisma } from "@/lib/db-local";
import { isDueSoon, type Candidate } from "@/lib/notification-prefs";
import { dispatchNotifications } from "@/lib/notifications";
import { cardWatcherIds } from "@/server/watchers";

const DAY = 24 * 60 * 60 * 1000;

export async function runDueSoon(now: Date = new Date()): Promise<number> {
  const cards = await prisma.taskCard.findMany({
    where: {
      deadline: { gt: new Date(now.getTime() - DAY), lte: new Date(now.getTime() + DAY) },
      column: { board: { archived: false } },
    },
    select: {
      id: true,
      title: true,
      deadline: true,
      columnId: true,
      assignees: { select: { userId: true } },
      column: {
        select: {
          boardId: true,
          board: { select: { columns: { orderBy: { position: "desc" }, take: 1, select: { id: true } } } },
        },
      },
    },
  });
  if (cards.length === 0) return 0;
  const notices = await prisma.dueSoonNotice.findMany({
    where: { cardId: { in: cards.map((c) => c.id) } },
    select: { cardId: true, deadline: true },
  });
  const announced = new Map(notices.map((n) => [n.cardId, n.deadline.getTime()]));

  let sent = 0;
  for (const card of cards) {
    const deadline = card.deadline;
    if (!deadline || !isDueSoon(deadline, now)) continue;
    if (card.column.board.columns[0]?.id === card.columnId) continue; // done
    if (announced.get(card.id) === deadline.getTime()) continue;
    const boardId = card.column.boardId;
    const watchers = await cardWatcherIds(card.id, boardId);
    const candidates: Candidate[] = [
      ...card.assignees.map((a) => ({ userId: a.userId, type: "dueSoon" as const })),
      ...watchers.map((userId) => ({ userId, type: "dueSoon" as const })),
    ];
    // Mark first: a crash after this point skips one reminder instead of
    // repeating it every run.
    await prisma.dueSoonNotice.upsert({
      where: { cardId: card.id },
      update: { deadline, sentAt: now },
      create: { cardId: card.id, deadline, sentAt: now },
    });
    await dispatchNotifications({ cardId: card.id, cardTitle: card.title, boardId, actorId: null, actorName: null }, candidates);
    sent++;
  }
  return sent;
}
