// Watchers: people following a card or a board, and the notifications that
// fan out to them. Server-only helpers called from the card actions; the
// toggle actions live in watch-actions.ts.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { dispatchNotifications, parseMentions, type NotifyEvent } from "@/lib/notifications";
import type { Candidate } from "@/lib/notification-prefs";

type Db = Prisma.TransactionClient | typeof prisma;

/** Start watching a card (no-op when already watching). */
export async function watchCard(cardId: string, userId: string, db: Db = prisma): Promise<void> {
  await db.cardWatcher.upsert({
    where: { cardId_userId: { cardId, userId } },
    update: {},
    create: { cardId, userId },
  });
}

/** Only people who can still open the board hear about it. */
function canSeeBoard(boardId: string): Prisma.UserWhereInput {
  return { deactivatedAt: null, OR: [{ role: "admin" }, { boards: { some: { boardId } } }] };
}

export async function cardWatcherIds(cardId: string, boardId: string): Promise<string[]> {
  const rows = await prisma.cardWatcher.findMany({
    where: { cardId, user: canSeeBoard(boardId) },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function boardWatcherIds(boardId: string): Promise<string[]> {
  const rows = await prisma.boardWatcher.findMany({
    where: { boardId, user: canSeeBoard(boardId) },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

const as = (type: Candidate["type"]) => (userId: string): Candidate => ({ userId, type });

/** A new comment: mentioned board members get "mention", card watchers "comment". */
export async function notifyComment(event: NotifyEvent & { cardId: string; boardId: string }, body: string) {
  const usernames = parseMentions(body);
  const [mentioned, watchers] = await Promise.all([
    usernames.length
      ? prisma.user.findMany({
          where: { username: { in: usernames }, deactivatedAt: null, boards: { some: { boardId: event.boardId } } },
          select: { id: true },
        })
      : Promise.resolve([]),
    cardWatcherIds(event.cardId, event.boardId),
  ]);
  await dispatchNotifications(event, [...mentioned.map((u) => u.id).map(as("mention")), ...watchers.map(as("comment"))]);
}

/** A card moved to another column: tell its watchers, naming the destination. */
export async function notifyMoved(event: NotifyEvent & { cardId: string; boardId: string; toColumnName: string }) {
  const { toColumnName, ...rest } = event;
  const watchers = await cardWatcherIds(event.cardId, event.boardId);
  await dispatchNotifications({ ...rest, data: { column: toColumnName } }, watchers.map(as("moved")));
}

/**
 * New cards on a board: tell the board's watchers. One card gets a
 * notification about that card; several created together (a pasted list)
 * get one notification for all of them, linking to the board.
 */
export async function notifyNewCards(
  boardId: string,
  cards: { id: string; title: string }[],
  actor: { id: string; name: string }
) {
  if (cards.length === 0) return;
  const watchers = await boardWatcherIds(boardId);
  if (watchers.length === 0) return;
  const recipients = watchers.map(as("newCard"));
  if (cards.length === 1) {
    const [c] = cards;
    await dispatchNotifications({ cardId: c.id, cardTitle: c.title, boardId, actorId: actor.id, actorName: actor.name }, recipients);
    return;
  }
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  const name = board?.name ?? "";
  await dispatchNotifications(
    {
      cardId: null,
      cardTitle: name,
      boardId,
      actorId: actor.id,
      actorName: actor.name,
      data: { count: String(cards.length), board: name },
    },
    recipients
  );
}

/** A checklist item was assigned to someone else: tell them. */
export async function notifySubtaskAssigned(event: NotifyEvent & { cardId: string; boardId: string; recipientId: string; item: string }) {
  const { recipientId, item, ...rest } = event;
  await dispatchNotifications({ ...rest, data: { item } }, [{ userId: recipientId, type: "subtaskAssigned" }]);
}
