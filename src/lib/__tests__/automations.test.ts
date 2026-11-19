import { describe, expect, it } from "vitest";
import {
  automationFromExport,
  automationRuleInputSchema,
  automationToExport,
  deadlineInDays,
  deadlinePassed,
  describeRule,
  parseActions,
  planActions,
  type CardState,
  type PlanContext,
  type RuleNames,
} from "@/lib/automations";

const NOW = new Date("2026-11-19T15:30:00.000Z");

const ctx: PlanContext = {
  now: NOW,
  memberIds: new Set(["ada", "bob"]),
  tagIds: new Set(["blocked", "urgent"]),
  columnIds: new Set(["todo", "doing", "done"]),
};

const card: CardState = {
  columnId: "done",
  priority: "normal",
  deadline: "2026-11-20T00:00:00.000Z",
  assigneeIds: ["ada"],
  tagIds: ["blocked"],
  openSubtaskIds: ["s1", "s2"],
};

const names: RuleNames = {
  columns: new Map([
    ["todo", "To do"],
    ["doing", "Doing"],
    ["done", "Done"],
  ]),
  tags: new Map([
    ["blocked", "Blocked"],
    ["urgent", "Urgent"],
  ]),
  users: new Map([
    ["ada", "Ada"],
    ["bob", "Bob"],
  ]),
};

describe("planActions", () => {
  it("lists every change in order and returns the card afterwards", () => {
    const { changes, card: after } = planActions(
      card,
      [
        { type: "completeChecklist" },
        { type: "removeTag", tagId: "blocked" },
        { type: "assign", userIds: ["bob"] },
        { type: "setPriority", priority: "high" },
        { type: "setDeadline", days: 3 },
      ],
      ctx
    );
    expect(changes).toEqual([
      { kind: "checklistDone", subtaskIds: ["s1", "s2"] },
      { kind: "tagRemove", tagId: "blocked" },
      { kind: "assigneeAdd", userId: "bob" },
      { kind: "priority", from: "normal", to: "high" },
      { kind: "deadline", from: "2026-11-20T00:00:00.000Z", to: "2026-11-22T00:00:00.000Z" },
    ]);
    expect(after).toEqual({
      columnId: "done",
      priority: "high",
      deadline: "2026-11-22T00:00:00.000Z",
      assigneeIds: ["ada", "bob"],
      tagIds: [],
      openSubtaskIds: [],
    });
    // The input is not touched.
    expect(card.tagIds).toEqual(["blocked"]);
  });

  it("skips actions that would change nothing", () => {
    const { changes } = planActions(
      { ...card, openSubtaskIds: [] },
      [
        { type: "addTag", tagId: "blocked" }, // already there
        { type: "removeTag", tagId: "urgent" }, // not there
        { type: "assign", userIds: ["ada"] }, // already assigned
        { type: "setPriority", priority: "normal" }, // unchanged
        { type: "completeChecklist" }, // nothing open
        { type: "moveToColumn", columnId: "done" }, // already there
      ],
      ctx
    );
    expect(changes).toEqual([]);
  });

  it("ignores ids that are not on the board (deleted tag, column, former member)", () => {
    const { changes } = planActions(
      card,
      [
        { type: "addTag", tagId: "gone" },
        { type: "assign", userIds: ["carol"] },
        { type: "moveToColumn", columnId: "gone" },
      ],
      ctx
    );
    expect(changes).toEqual([]);
  });

  it("clears assignees and the deadline, and moves", () => {
    const { changes, card: after } = planActions(
      { ...card, assigneeIds: ["ada", "bob"] },
      [{ type: "unassignAll" }, { type: "clearDeadline" }, { type: "moveToColumn", columnId: "todo" }],
      ctx
    );
    expect(changes).toEqual([
      { kind: "assigneeRemove", userId: "ada" },
      { kind: "assigneeRemove", userId: "bob" },
      { kind: "deadline", from: "2026-11-20T00:00:00.000Z", to: null },
      { kind: "move", fromColumnId: "done", toColumnId: "todo" },
    ]);
    expect(after.columnId).toBe("todo");
    expect(after.assigneeIds).toEqual([]);
  });
});

describe("deadlines", () => {
  it("today + N is a UTC calendar date", () => {
    expect(deadlineInDays(NOW, 0)).toBe("2026-11-19T00:00:00.000Z");
    expect(deadlineInDays(NOW, 14)).toBe("2026-12-03T00:00:00.000Z");
  });

  it("a deadline passes once its whole day is over", () => {
    const deadline = new Date("2026-11-19T00:00:00.000Z");
    expect(deadlinePassed(deadline, new Date("2026-11-19T23:59:59.000Z"))).toBe(false);
    expect(deadlinePassed(deadline, new Date("2026-11-20T00:00:00.000Z"))).toBe(true);
  });
});

describe("automationRuleInputSchema", () => {
  it("accepts a column rule and drops the column of a deadline rule", () => {
    const rule = automationRuleInputSchema.parse({
      name: " Done cleanup ",
      trigger: "cardEntersColumn",
      columnId: "done",
      actions: [{ type: "completeChecklist" }],
    });
    expect(rule).toEqual({
      name: "Done cleanup",
      trigger: "cardEntersColumn",
      columnId: "done",
      actions: [{ type: "completeChecklist" }],
      enabled: true,
    });
    const deadline = automationRuleInputSchema.parse({
      name: "Late",
      trigger: "deadlinePassed",
      columnId: "done",
      actions: [{ type: "addTag", tagId: "urgent" }],
    });
    expect(deadline.columnId).toBeNull();
  });

  it("refuses a column rule without its column, no actions, or actions of the other trigger", () => {
    const bad = [
      { name: "a", trigger: "cardEntersColumn", actions: [{ type: "completeChecklist" }] },
      { name: "a", trigger: "cardEntersColumn", columnId: "done", actions: [] },
      { name: "a", trigger: "cardEntersColumn", columnId: "done", actions: [{ type: "moveToColumn", columnId: "todo" }] },
      { name: "a", trigger: "deadlinePassed", actions: [{ type: "completeChecklist" }] },
      { name: "a", trigger: "cardEntersColumn", columnId: "done", actions: [{ type: "setDeadline", days: -1 }] },
      { name: "", trigger: "deadlinePassed", actions: [{ type: "addTag", tagId: "x" }] },
    ];
    for (const input of bad) expect(automationRuleInputSchema.safeParse(input).success).toBe(false);
  });

  it("parseActions drops unreadable stored actions", () => {
    expect(parseActions('[{"type":"completeChecklist"},{"type":"explode"},{"type":"addTag"}]')).toEqual([
      { type: "completeChecklist" },
    ]);
    expect(parseActions("not json")).toEqual([]);
  });
});

describe("describeRule", () => {
  it("reads as one plain sentence", () => {
    expect(
      describeRule(
        {
          trigger: "cardEntersColumn",
          columnId: "done",
          actions: [{ type: "completeChecklist" }, { type: "removeTag", tagId: "blocked" }],
        },
        names,
        "en"
      )
    ).toBe("When a card enters Done: mark the checklist done, remove tag Blocked");
    expect(
      describeRule(
        {
          trigger: "deadlinePassed",
          columnId: null,
          actions: [{ type: "moveToColumn", columnId: "doing" }, { type: "addTag", tagId: "urgent" }],
        },
        names,
        "en"
      )
    ).toBe("When a card's deadline passes: move to Doing, add tag Urgent");
  });

  it("counts days and names what was deleted", () => {
    expect(
      describeRule(
        {
          trigger: "cardEntersColumn",
          columnId: "gone",
          actions: [
            { type: "setDeadline", days: 1 },
            { type: "setDeadline", days: 3 },
            { type: "setDeadline", days: 0 },
            { type: "addTag", tagId: "gone" },
            { type: "assign", userIds: ["ada", "bob"] },
            { type: "setPriority", priority: "critical" },
          ],
        },
        names,
        "en"
      )
    ).toBe(
      "When a card enters a deleted column: set the deadline to today + 1 day, set the deadline to today + 3 days, " +
        "set the deadline to today, add tag a deleted tag, assign Ada, Bob, set priority to Critical"
    );
  });
});

describe("export and import", () => {
  it("round-trips through names", () => {
    const rule = {
      name: "Done cleanup",
      enabled: false,
      trigger: "cardEntersColumn",
      columnId: "done",
      actions: [
        { type: "assign" as const, userIds: ["ada", "gone"] },
        { type: "removeTag" as const, tagId: "blocked" },
        { type: "setDeadline" as const, days: 2 },
      ],
    };
    const exported = automationToExport(rule, names);
    expect(exported).toEqual({
      name: "Done cleanup",
      enabled: false,
      trigger: "cardEntersColumn",
      column: "Done",
      actions: [
        { type: "assign", users: ["Ada"] },
        { type: "removeTag", tag: "Blocked" },
        { type: "setDeadline", days: 2 },
      ],
    });
    const back = automationFromExport(
      { ...exported, actions: [...exported.actions, { type: "fromTheFuture", x: 1 }] },
      {
        column: (n) => (n === "Done" ? "col-9" : undefined),
        tag: (n) => (n === "Blocked" ? "tag-9" : undefined),
        user: (n) => (n === "Ada" ? "user-9" : undefined),
      }
    );
    expect(back).toEqual({
      name: "Done cleanup",
      enabled: false,
      trigger: "cardEntersColumn",
      columnId: "col-9",
      actions: [
        { type: "assign", userIds: ["user-9"] },
        { type: "removeTag", tagId: "tag-9" },
        { type: "setDeadline", days: 2 },
      ],
    });
  });

  it("skips a rule whose column or every action is missing", () => {
    const none = { column: () => undefined, tag: () => undefined, user: () => undefined };
    expect(
      automationFromExport({ name: "x", enabled: true, trigger: "cardEntersColumn", column: "Done", actions: [{ type: "completeChecklist" }] }, none)
    ).toBeNull();
    expect(
      automationFromExport({ name: "x", enabled: true, trigger: "deadlinePassed", column: null, actions: [{ type: "addTag", tag: "Gone" }] }, none)
    ).toBeNull();
  });
});
