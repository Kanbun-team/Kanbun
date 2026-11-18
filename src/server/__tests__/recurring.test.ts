import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runRecurringCards } from "@/server/jobs/recurring";
import { createTestDb } from "./test-db";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let boardId: string;
let columnId: string;
let templateId: string;
let tagId: string;
let userId: string;

beforeAll(async () => {
  ({ db, cleanup } = createTestDb());
  const user = await db.user.create({ data: { username: "ada", passwordHash: "x", role: "admin" } });
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.board.deleteMany();
  const board = await db.board.create({
    data: {
      name: "Ops",
      columns: { create: [{ name: "To do", position: 0 }] },
      tags: { create: [{ name: "Chore", color: "#64748b" }] },
    },
    include: { columns: true, tags: true },
  });
  boardId = board.id;
  columnId = board.columns[0].id;
  tagId = board.tags[0].id;
  const template = await db.cardTemplate.create({
    data: {
      boardId,
      name: "Weekly review",
      title: "Review the week",
      description: "Look back, plan ahead.",
      priority: "high",
      tagIds: JSON.stringify([tagId, "gone-tag"]),
      checklist: JSON.stringify(["Inbox zero", "Update roadmap"]),
    },
  });
  templateId = template.id;
});

const at = (y: number, m: number, d: number, hh = 0) => new Date(y, m - 1, d, hh);

async function schedule(nextRunAt: Date) {
  return db.cardRecurrence.create({
    data: { boardId, templateId, columnId, rule: "weekly", weekday: 1, nextRunAt, createdById: userId },
  });
}

describe("runRecurringCards", () => {
  it("creates the due card from the template and advances nextRunAt", async () => {
    // Monday 2026-11-16 00:00 was due; the job runs on Wednesday.
    const r = await schedule(at(2026, 11, 16));
    const result = await runRecurringCards(at(2026, 11, 18, 10), db);
    expect(result.created).toBe(1);

    const cards = await db.taskCard.findMany({
      where: { columnId },
      include: { tags: true, subtasks: { orderBy: { position: "asc" } } },
    });
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card).toMatchObject({ title: "Review the week", description: "Look back, plan ahead.", priority: "high" });
    expect(card.tags.map((tg) => tg.tagId)).toEqual([tagId]);
    expect(card.subtasks.map((s) => [s.title, s.done, s.position])).toEqual([
      ["Inbox zero", false, 0],
      ["Update roadmap", false, 1],
    ]);
    const activity = await db.cardActivity.findMany({ where: { cardId: card.id } });
    expect(activity.map((a) => a.type)).toEqual(["createdBySchedule"]);

    const after = await db.cardRecurrence.findUniqueOrThrow({ where: { id: r.id } });
    // One card for the missed slot, then the next Monday after "now".
    expect(after.nextRunAt).toEqual(at(2026, 11, 23));
    expect(after.lastRunAt).toEqual(at(2026, 11, 18, 10));
  });

  it("never creates twice for the same slot", async () => {
    await schedule(at(2026, 11, 16));
    const now = at(2026, 11, 18, 10);
    // Overlapping runs: one claims the slot; the other finds it taken (or,
    // with SQLite, may give up on the lock). Either way one card.
    const runs = await Promise.allSettled([runRecurringCards(now, db), runRecurringCards(now, db)]);
    const created = runs.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.created : 0), 0);
    expect(created).toBe(1);
    expect(await runRecurringCards(now, db)).toEqual({ created: 0 });
    expect(await db.taskCard.count({ where: { columnId } })).toBe(1);
  });

  it("skips schedules that are not due or paused", async () => {
    await schedule(at(2026, 11, 23));
    await db.cardRecurrence.create({
      data: { boardId, templateId, columnId, rule: "daily", nextRunAt: at(2026, 11, 1), active: false },
    });
    expect(await runRecurringCards(at(2026, 11, 18), db)).toEqual({ created: 0 });
  });

  it("deactivates a schedule whose column or template was deleted", async () => {
    const r = await schedule(at(2026, 11, 16));
    await db.boardColumn.delete({ where: { id: columnId } });
    expect(await runRecurringCards(at(2026, 11, 18), db)).toEqual({ created: 0 });
    const after = await db.cardRecurrence.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.columnId).toBeNull();
    expect(after.active).toBe(false);
  });
});
