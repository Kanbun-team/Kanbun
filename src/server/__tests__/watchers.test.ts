import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";

const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/lib/db-local", () => ({
  get prisma() {
    return holder.db;
  },
}));

const { notifyMoved, notifyNewCards, notifySubtaskAssigned } = await import("@/server/watchers");
const { getNotifications } = await import("@/lib/notifications");
const { notificationText } = await import("@/lib/notification-prefs");

let cleanup: () => Promise<void>;
let db: PrismaClient;
let ada: { id: string; name: string };
let marta: string;
let boardId: string;
let cardId: string;

beforeAll(async () => {
  ({ db, cleanup } = createTestDb());
  holder.db = db;
  const a = await db.user.create({ data: { username: "ada", displayName: "Ada", passwordHash: "x" } });
  ada = { id: a.id, name: "Ada" };
  marta = (await db.user.create({ data: { username: "marta", passwordHash: "x" } })).id;
  const board = await db.board.create({
    data: {
      name: "Website",
      createdById: a.id,
      members: { create: [{ userId: a.id, role: "owner" }, { userId: marta, role: "member" }] },
      watchers: { create: [{ userId: marta }] },
      columns: { create: [{ name: "To do", position: 0 }] },
    },
    include: { columns: true },
  });
  boardId = board.id;
  const card = await db.taskCard.create({ data: { columnId: board.columns[0].id, title: "Hero", position: 0 } });
  cardId = card.id;
  await db.cardWatcher.create({ data: { cardId, userId: marta } });
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.notification.deleteMany({});
});

const textsFor = async (userId: string) =>
  (await getNotifications(userId)).items.map((n) => notificationText(n, "en"));

describe("watcher notifications", () => {
  it("coalesces several new cards into one notification about the board", async () => {
    await notifyNewCards(
      boardId,
      [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, title: `Card ${i}` })),
      ada
    );
    expect(await textsFor(marta)).toEqual(['Ada added 5 cards to "Website"']);
    const [n] = (await getNotifications(marta)).items;
    expect(n.cardId).toBeNull();
    expect(n.boardId).toBe(boardId);
    expect(await textsFor(ada.id)).toEqual([]);
  });

  it("keeps one notification per card for a single new card", async () => {
    await notifyNewCards(boardId, [{ id: cardId, title: "Hero" }], ada);
    expect(await textsFor(marta)).toEqual(['Ada added "Hero"']);
  });

  it("names the destination column of a move", async () => {
    await notifyMoved({ cardId, cardTitle: "Hero", boardId, actorId: ada.id, actorName: "Ada", toColumnName: "Done" });
    expect(await textsFor(marta)).toEqual(['Ada moved "Hero" to "Done"']);
  });

  it("tells the person a checklist item was assigned to, not the actor", async () => {
    await notifySubtaskAssigned({ recipientId: marta, item: "Write copy", cardId, cardTitle: "Hero", boardId, actorId: ada.id, actorName: "Ada" });
    await notifySubtaskAssigned({ recipientId: ada.id, item: "Self", cardId, cardTitle: "Hero", boardId, actorId: ada.id, actorName: "Ada" });
    expect(await textsFor(marta)).toEqual(['Ada assigned you "Write copy" on "Hero"']);
    expect(await textsFor(ada.id)).toEqual([]);
  });

  it("respects the subtaskAssigned preference", async () => {
    await db.user.update({ where: { id: marta }, data: { notificationPrefs: JSON.stringify({ subtaskAssigned: "none" }) } });
    await notifySubtaskAssigned({ recipientId: marta, item: "Write copy", cardId, cardTitle: "Hero", boardId, actorId: ada.id, actorName: "Ada" });
    expect(await textsFor(marta)).toEqual([]);
    await db.user.update({ where: { id: marta }, data: { notificationPrefs: "{}" } });
  });
});
