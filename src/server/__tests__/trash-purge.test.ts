import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";

const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient, removed: [] as string[] }));
vi.mock("@/lib/db-local", () => ({
  get prisma() {
    return holder.db;
  },
}));
vi.mock("@/server/attachment-storage", () => ({
  removeAttachmentFiles: async (keys: string[]) => {
    holder.removed.push(...keys);
  },
}));

const { trashCard, trashColumn, runTrashPurge, TRASH_RETENTION_DAYS } = await import("@/server/trash");

let cleanup: () => Promise<void>;
let db: PrismaClient;
let userId: string;
let boardId: string;

const DAY = 24 * 60 * 60 * 1000;

async function cardWithHistory(columnId: string, title: string) {
  const card = await db.taskCard.create({ data: { columnId, title, position: 0, createdById: userId } });
  await db.cardActivity.create({ data: { cardId: card.id, boardId, type: "created", actorId: userId } });
  await db.dueSoonNotice.create({ data: { cardId: card.id, deadline: new Date() } });
  await db.notification.create({ data: { userId, type: "assigned", cardId: card.id, cardTitle: title, boardId } });
  return card.id;
}

const leftovers = async (cardId: string) => ({
  activity: await db.cardActivity.count({ where: { cardId } }),
  notices: await db.dueSoonNotice.count({ where: { cardId } }),
  notifications: await db.notification.count({ where: { cardId } }),
});

beforeAll(async () => {
  ({ db, cleanup } = createTestDb());
  holder.db = db;
  const user = await db.user.create({ data: { username: "ada", passwordHash: "x" } });
  userId = user.id;
  const board = await db.board.create({ data: { name: "B", createdById: userId } });
  boardId = board.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("trash purge", () => {
  it("keeps the history of trashed cards until the item expires, then deletes it", async () => {
    const col = await db.boardColumn.create({ data: { boardId, name: "To do", position: 0 } });
    const fresh = await cardWithHistory(col.id, "Fresh");
    const old = await cardWithHistory(col.id, "Old");
    await trashCard(fresh, userId);
    const oldItem = await trashCard(old, userId);
    await db.trashItem.update({
      where: { id: oldItem },
      data: { deletedAt: new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * DAY) },
    });

    await runTrashPurge();

    expect(await db.trashItem.findUnique({ where: { id: oldItem } })).toBeNull();
    expect(await leftovers(old)).toEqual({ activity: 0, notices: 0, notifications: 0 });
    // Still restorable, so its history stays.
    expect(await leftovers(fresh)).toEqual({ activity: 1, notices: 1, notifications: 1 });
  });

  it("deletes the history of every card in an expired column", async () => {
    const col = await db.boardColumn.create({ data: { boardId, name: "Doing", position: 1 } });
    const a = await cardWithHistory(col.id, "A");
    const b = await cardWithHistory(col.id, "B");
    const item = await trashColumn(col.id, userId);
    const later = new Date(Date.now() + (TRASH_RETENTION_DAYS + 1) * DAY);
    await runTrashPurge(later);
    expect(await db.trashItem.findUnique({ where: { id: item } })).toBeNull();
    expect(await leftovers(a)).toEqual({ activity: 0, notices: 0, notifications: 0 });
    expect(await leftovers(b)).toEqual({ activity: 0, notices: 0, notifications: 0 });
  });
});
