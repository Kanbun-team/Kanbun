// Server-only notification helpers. Do NOT import from client components: this
// pulls in the Prisma client. The mutating server actions (mark read) live in
// the actions module; these are plain async helpers called from other server
// code.

import { prisma } from "@/lib/db-local";
import { publishUser } from "@/lib/realtime";

export type NotificationType = "assigned" | "mention" | "blocked";

export interface NotifyInput {
  recipientId: string;
  type: NotificationType;
  cardTitle: string;
  cardId?: string | null;
  boardId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

export async function notify(input: NotifyInput): Promise<void> {
  // Never notify someone about their own action.
  if (input.actorId && input.actorId === input.recipientId) return;
  await prisma.notification.create({
    data: {
      userId: input.recipientId,
      type: input.type,
      cardId: input.cardId ?? null,
      cardTitle: input.cardTitle,
      boardId: input.boardId ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
    },
  });
  publishUser(input.recipientId);
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  await Promise.all(inputs.map((i) => notify(i)));
}

/** Extract unique, lowercased @usernames from a comment body. */
export function parseMentions(body: string): string[] {
  const set = new Set<string>();
  const re = /@([a-z0-9_.-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) set.add(m[1].toLowerCase());
  return [...set];
}

export interface NotificationView {
  id: string;
  type: string;
  read: boolean;
  createdAt: string;
  cardId: string | null;
  cardTitle: string;
  boardId: string | null;
  actorName: string | null;
}

export async function getNotifications(
  userId: string
): Promise<{ items: NotificationView[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      read: r.read,
      createdAt: r.createdAt.toISOString(),
      cardId: r.cardId,
      cardTitle: r.cardTitle,
      boardId: r.boardId,
      actorName: r.actorName,
    })),
    unread,
  };
}
