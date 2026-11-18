// Server-only helper that records card history (CardActivity). Pass the
// transaction client when the change itself runs in a transaction, so the
// entry is written (or rolled back) together with it.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import type { ActivityInput } from "@/lib/activity";

type Db = PrismaClient | Prisma.TransactionClient;

export type ActivityEntry = ActivityInput & {
  cardId: string;
  boardId: string;
  actorId: string | null;
};

export async function logActivity(entries: ActivityEntry | ActivityEntry[], db: Db = prisma): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await db.cardActivity.createMany({
    data: list.map((e) => ({
      cardId: e.cardId,
      boardId: e.boardId,
      type: e.type,
      data: JSON.stringify(e.data),
      actorId: e.actorId,
    })),
  });
}
