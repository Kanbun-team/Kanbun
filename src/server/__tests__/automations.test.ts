import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { deadlineRunKey, runDeadlineRules, runEnterColumnRules, undoAutomationRun } from "@/server/automations";
import { MAX_RULE_DEPTH, type AutomationAction } from "@/lib/automations";
import { activityRule, formatActivity, parseActivityData } from "@/lib/activity";
import { createTestDb } from "./test-db";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
let boardId: string;
let todo: string;
let doing: string;
let review: string;
let done: string;
let blocked: string;
let late: string;

beforeAll(async () => {
  ({ db, cleanup } = createTestDb());
  const user = await db.user.create({ data: { username: "ada", passwordHash: "x", displayName: "Ada" } });
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.board.deleteMany();
  await db.automationRun.deleteMany();
  await db.cardActivity.deleteMany();
  const board = await db.board.create({
    data: {
      name: "Ops",
      members: { create: [{ userId, role: "owner" }] },
      columns: {
        create: [
          { name: "To do", position: 0 },
          { name: "Doing", position: 1 },
          { name: "Review", position: 2 },
          { name: "Done", position: 3 },
        ],
      },
      tags: { create: [{ name: "Blocked", color: "#b4321f" }, { name: "Late", color: "#8f5b00" }] },
    },
    include: { columns: { orderBy: { position: "asc" } }, tags: true },
  });
  boardId = board.id;
  [todo, doing, review, done] = board.columns.map((c) => c.id);
  blocked = board.tags.find((t) => t.name === "Blocked")!.id;
  late = board.tags.find((t) => t.name === "Late")!.id;
});

async function rule(
  name: string,
  trigger: "cardEntersColumn" | "deadlinePassed",
  columnId: string | null,
  actions: AutomationAction[],
  createdAt?: Date
) {
  return db.automationRule.create({
    data: { boardId, name, trigger, columnId, actions: JSON.stringify(actions), ...(createdAt ? { createdAt } : {}) },
  });
}

async function card(columnId: string, extra: { deadline?: Date; checklist?: string[]; tags?: string[] } = {}) {
  return db.taskCard.create({
    data: {
      columnId,
      title: "Ship it",
      position: 0,
      deadline: extra.deadline ?? null,
      subtasks: { create: (extra.checklist ?? []).map((title, position) => ({ title, position })) },
      tags: { create: (extra.tags ?? []).map((tagId) => ({ tagId })) },
    },
  });
}

/** What a move into `columnId` does: put the card there, then run the rules. */
async function moveInto(cardId: string, columnId: string) {
  return db.$transaction(async (tx) => {
    await tx.taskCard.update({ where: { id: cardId }, data: { columnId } });
    return runEnterColumnRules(tx, { cardId, boardId, columnId, actorId: userId });
  });
}

describe("rules on entering a column", () => {
  it("applies the actions and records them in the history as done by the rule", async () => {
    await rule("Done cleanup", "cardEntersColumn", done, [
      { type: "completeChecklist" },
      { type: "removeTag", tagId: blocked },
      { type: "setPriority", priority: "low" },
    ]);
    const c = await card(review, { checklist: ["Test", "Docs"], tags: [blocked] });
    const runs = await moveInto(c.id, done);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ruleName: "Done cleanup", fields: ["checklist", "tags", "priority"], move: null });
    const after = await db.taskCard.findUniqueOrThrow({ where: { id: c.id }, include: { subtasks: true, tags: true } });
    expect(after.subtasks.every((s) => s.done)).toBe(true);
    expect(after.tags).toEqual([]);
    expect(after.priority).toBe("low");

    const history = await db.cardActivity.findMany({ where: { cardId: c.id }, orderBy: { createdAt: "asc" } });
    const lines = history.map((h) => formatActivity(h.type, parseActivityData(h.data), "Rule “Done cleanup”", "en"));
    expect(lines).toEqual([
      "Rule “Done cleanup” marked 2 checklist items done",
      "Rule “Done cleanup” removed the tag Blocked",
      "Rule “Done cleanup” changed the priority from Normal to Low",
    ]);
    for (const h of history) {
      expect(parseActivityData(h.data)).toMatchObject({ rule: "Done cleanup", runId: runs[0].runId });
      expect(h.actorId).toBe(userId);
    }
  });

  it("runs nothing for disabled rules, other columns, or when nothing changes", async () => {
    await db.automationRule.update({
      where: { id: (await rule("Off", "cardEntersColumn", done, [{ type: "addTag", tagId: late }])).id },
      data: { enabled: false },
    });
    await rule("Elsewhere", "cardEntersColumn", doing, [{ type: "addTag", tagId: late }]);
    await rule("No-op", "cardEntersColumn", done, [{ type: "completeChecklist" }]);
    const c = await card(review);
    expect(await moveInto(c.id, done)).toEqual([]);
    expect(await db.automationRun.count()).toBe(0);
    expect(await db.cardActivity.count({ where: { cardId: c.id } })).toBe(0);
  });

  it("stops a chain of moves at the depth guard instead of looping", async () => {
    // The UI only offers moves to deadline rules, but the engine must hold
    // even for rules that move a card back and forth.
    await rule("Ping", "cardEntersColumn", doing, [{ type: "moveToColumn", columnId: review }]);
    await rule("Pong", "cardEntersColumn", review, [{ type: "moveToColumn", columnId: doing }]);
    const c = await card(todo);
    const runs = await moveInto(c.id, doing);

    expect(MAX_RULE_DEPTH).toBe(2);
    expect(runs.map((r) => r.ruleName)).toEqual(["Ping", "Pong"]);
    expect((await db.taskCard.findUniqueOrThrow({ where: { id: c.id } })).columnId).toBe(doing);
    expect(await db.automationRun.count()).toBe(2);
  });

  it("never runs the same rule twice in one chain", async () => {
    // Doing -> Review -> Doing again would be depth 3; with a deeper guard
    // the "fired" set would still stop Ping from running a second time.
    await rule("Ping", "cardEntersColumn", doing, [{ type: "moveToColumn", columnId: review }]);
    await rule("Tag in review", "cardEntersColumn", review, [{ type: "addTag", tagId: late }]);
    const c = await card(todo);
    const runs = await moveInto(c.id, doing);
    expect(runs.map((r) => r.ruleName)).toEqual(["Ping", "Tag in review"]);
    const tags = await db.taskCardTag.findMany({ where: { cardId: c.id } });
    expect(tags.map((t) => t.tagId)).toEqual([late]);
  });
});

describe("undo", () => {
  it("reverts a rule's changes and records who undid it", async () => {
    await rule("Done cleanup", "cardEntersColumn", done, [
      { type: "completeChecklist" },
      { type: "removeTag", tagId: blocked },
      { type: "addTag", tagId: late },
      { type: "setDeadline", days: 2 },
      { type: "assign", userIds: [userId] },
    ]);
    const deadline = new Date("2030-01-01T00:00:00.000Z");
    const c = await card(review, { checklist: ["Test"], tags: [blocked], deadline });
    const [run] = await moveInto(c.id, done);

    const result = await undoAutomationRun(run.runId, userId, db);
    expect(result).toMatchObject({ undone: true });
    const after = await db.taskCard.findUniqueOrThrow({
      where: { id: c.id },
      include: { subtasks: true, tags: true, assignees: true },
    });
    expect(after.subtasks.map((s) => s.done)).toEqual([false]);
    expect(after.tags.map((t) => t.tagId)).toEqual([blocked]);
    expect(after.assignees).toEqual([]);
    expect(after.deadline).toEqual(deadline);
    expect(after.columnId).toBe(done); // the user's own move stays

    const last = await db.cardActivity.findFirst({ where: { cardId: c.id }, orderBy: { createdAt: "desc" } });
    expect(last?.type).toBe("automationUndone");
    // The undo is the person's own entry, not one made by the rule.
    expect(activityRule(parseActivityData(last!.data))).toBeNull();
    expect(formatActivity(last!.type, parseActivityData(last!.data), "Ada", "en")).toBe(
      "Ada undid the changes of the rule “Done cleanup”"
    );
    // A second undo (double click, another person) changes nothing.
    expect(await undoAutomationRun(run.runId, userId, db)).toMatchObject({ undone: false });
  });

  it("keeps what someone changed by hand since", async () => {
    await rule("Prioritize", "cardEntersColumn", doing, [{ type: "setPriority", priority: "high" }]);
    const c = await card(todo);
    const [run] = await moveInto(c.id, doing);
    await db.taskCard.update({ where: { id: c.id }, data: { priority: "critical" } });
    await undoAutomationRun(run.runId, userId, db);
    expect((await db.taskCard.findUniqueOrThrow({ where: { id: c.id } })).priority).toBe("critical");
  });

  it("moves a card back to where it was", async () => {
    const late = await rule("Overdue", "deadlinePassed", null, [{ type: "moveToColumn", columnId: review }], new Date("2026-01-01"));
    void late;
    const first = await card(doing, { deadline: new Date("2026-11-10T00:00:00.000Z") });
    const other = await card(doing);
    await db.taskCard.update({ where: { id: other.id }, data: { position: 1 } });
    const { runs } = await runDeadlineRules(new Date("2026-11-19T12:00:00.000Z"), db);
    expect((await db.taskCard.findUniqueOrThrow({ where: { id: first.id } })).columnId).toBe(review);
    await undoAutomationRun(runs[0].runId, userId, db);
    const back = await db.taskCard.findMany({ where: { columnId: doing }, orderBy: { position: "asc" } });
    expect(back.map((b) => b.id)).toEqual([first.id, other.id]);
  });
});

describe("deadline rules", () => {
  const ruleCreated = new Date("2026-11-01T00:00:00.000Z");
  const now = new Date("2026-11-19T12:00:00.000Z");

  it("runs once per card and deadline, and again for a new deadline", async () => {
    const r = await rule("Overdue", "deadlinePassed", null, [{ type: "moveToColumn", columnId: review }, { type: "addTag", tagId: late }], ruleCreated);
    const c = await card(doing, { deadline: new Date("2026-11-17T00:00:00.000Z") });

    const first = await runDeadlineRules(now, db);
    expect(first.runs.map((x) => x.ruleName)).toEqual(["Overdue"]);
    expect(first.runs[0].move).toMatchObject({ from: { columnName: "Doing" }, to: { columnName: "Review" } });
    const moved = await db.taskCard.findUniqueOrThrow({ where: { id: c.id }, include: { tags: true } });
    expect(moved.columnId).toBe(review);
    expect(moved.tags.map((t) => t.tagId)).toEqual([late]);

    // Moving it back by hand does not make the job run again for this deadline.
    await db.taskCard.update({ where: { id: c.id }, data: { columnId: doing } });
    expect((await runDeadlineRules(now, db)).runs).toEqual([]);
    expect((await runDeadlineRules(new Date("2026-11-25T12:00:00.000Z"), db)).runs).toEqual([]);
    expect(await db.automationRun.count({ where: { dedupeKey: deadlineRunKey(r.id, c.id, moved.deadline!) } })).toBe(1);

    // A new deadline that passes is handled again.
    await db.taskCard.update({ where: { id: c.id }, data: { deadline: new Date("2026-11-18T00:00:00.000Z") } });
    expect((await runDeadlineRules(now, db)).runs).toHaveLength(1);
  });

  it("is safe when two runs overlap (several instances)", async () => {
    await rule("Tag late", "deadlinePassed", null, [{ type: "addTag", tagId: late }], ruleCreated);
    const c = await card(doing, { deadline: new Date("2026-11-17T00:00:00.000Z") });
    const results = await Promise.allSettled([runDeadlineRules(now, db), runDeadlineRules(now, db)]);
    const runs = results.flatMap((x) => (x.status === "fulfilled" ? x.value.runs : []));
    expect(runs.filter((x) => x.changes.length > 0)).toHaveLength(1);
    expect(await db.automationRun.count({ where: { cardId: c.id } })).toBe(1);
    expect(await db.cardActivity.count({ where: { cardId: c.id, type: "tagAdded" } })).toBe(1);
  });

  it("skips deadlines that have not passed, done cards, and cards overdue before the rule existed", async () => {
    await rule("Tag late", "deadlinePassed", null, [{ type: "addTag", tagId: late }], ruleCreated);
    await card(doing, { deadline: new Date("2026-11-19T00:00:00.000Z") }); // due today
    await card(done, { deadline: new Date("2026-11-10T00:00:00.000Z") }); // done
    await card(doing, { deadline: new Date("2026-10-01T00:00:00.000Z") }); // overdue before the rule
    expect((await runDeadlineRules(now, db)).runs).toEqual([]);
  });

  it("runs the rules of the column it moved the card into, once", async () => {
    await rule("Overdue", "deadlinePassed", null, [{ type: "moveToColumn", columnId: review }], ruleCreated);
    await rule("Review needs a tag", "cardEntersColumn", review, [{ type: "addTag", tagId: blocked }]);
    await rule("Bounce", "cardEntersColumn", review, [{ type: "moveToColumn", columnId: doing }]);
    await rule("Back in doing", "cardEntersColumn", doing, [{ type: "addTag", tagId: late }]);
    const c = await card(doing, { deadline: new Date("2026-11-17T00:00:00.000Z") });
    const { runs } = await runDeadlineRules(now, db);
    // Depth 1 is the deadline rule, depth 2 the Review rules; the bounce
    // back to Doing does not set off Doing's rules (that would be depth 3).
    expect(runs.map((r) => r.ruleName)).toEqual(["Overdue", "Review needs a tag", "Bounce"]);
    const after = await db.taskCard.findUniqueOrThrow({ where: { id: c.id }, include: { tags: true } });
    expect(after.columnId).toBe(doing);
    expect(after.tags.map((t) => t.tagId)).toEqual([blocked]);
  });
});
