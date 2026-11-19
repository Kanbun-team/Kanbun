import { describe, expect, it } from "vitest";
import {
  applyOutbox,
  blankCard,
  enqueue,
  referencesTempId,
  replay,
  resolveOp,
  splitTitles,
  TEMP_PREFIX,
  type OutboxEntry,
  type OutboxOp,
  type RunResult,
} from "@/lib/outbox";
import type { ColumnDTO } from "@/components/board/types";

let seq = 0;
function entry(op: OutboxOp, label = "card"): OutboxEntry {
  seq += 1;
  return { id: `e${seq}`, boardId: "b1", createdAt: seq, label, op };
}

const ann = { id: "u1", displayName: "Ann", username: "ann", avatarUrl: null };
const bug = { id: "t1", name: "Bug", color: "#ff0000" };

function board(): ColumnDTO[] {
  return [
    { id: "todo", name: "To do", position: 0, wipLimit: null, cards: [blankCard("c1", "One", 0), blankCard("c2", "Two", 1)] },
    { id: "done", name: "Done", position: 1, wipLimit: null, cards: [blankCard("c3", "Three", 0)] },
  ];
}

const titles = (cols: ColumnDTO[]) => cols.map((c) => c.cards.map((card) => card.title));

describe("enqueue", () => {
  it("keeps entries in order", () => {
    const a = entry({ kind: "move", cardId: "c1", toColumnId: "done", position: 0 });
    const b = entry({ kind: "update", cardId: "c2", fields: { title: "x" } });
    expect(enqueue(enqueue([], a), b).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("collapses repeated edits of the same card into one update, latest value wins", () => {
    let list = enqueue([], entry({ kind: "update", cardId: "c1", fields: { title: "A" } }));
    list = enqueue(list, entry({ kind: "move", cardId: "c2", toColumnId: "done", position: 0 }));
    list = enqueue(list, entry({ kind: "update", cardId: "c1", fields: { title: "B", priority: "high" } }));
    list = enqueue(list, entry({ kind: "update", cardId: "c1", fields: { title: "C" } }, "C"));
    expect(list).toHaveLength(2);
    expect(list[0].op).toEqual({ kind: "update", cardId: "c1", fields: { title: "C", priority: "high" } });
    expect(list[0].label).toBe("C");
  });

  it("keeps only the latest assignee and tag state per card and person or tag", () => {
    let list = enqueue([], entry({ kind: "assignee", cardId: "c1", user: ann, on: true }));
    list = enqueue(list, entry({ kind: "tag", cardId: "c1", tag: bug, on: true }));
    list = enqueue(list, entry({ kind: "assignee", cardId: "c1", user: ann, on: false }));
    list = enqueue(list, entry({ kind: "assignee", cardId: "c2", user: ann, on: true }));
    expect(list.map((e) => [e.op.kind, (e.op as { on: boolean }).on])).toEqual([
      ["tag", true],
      ["assignee", false],
      ["assignee", true],
    ]);
  });

  it("replaces a move of the same card only when it is the last entry", () => {
    let list = enqueue([], entry({ kind: "move", cardId: "c1", toColumnId: "done", position: 0 }));
    list = enqueue(list, entry({ kind: "move", cardId: "c1", toColumnId: "todo", position: 1 }));
    expect(list).toHaveLength(1);
    expect(list[0].op).toMatchObject({ toColumnId: "todo", position: 1 });
    list = enqueue(list, entry({ kind: "move", cardId: "c2", toColumnId: "done", position: 0 }));
    list = enqueue(list, entry({ kind: "move", cardId: "c1", toColumnId: "done", position: 1 }));
    expect(list).toHaveLength(3);
  });

  it("never changes the entry being sent", () => {
    const sending = entry({ kind: "update", cardId: "c1", fields: { title: "A" } });
    const list = enqueue([sending], entry({ kind: "update", cardId: "c1", fields: { priority: "low" } }), sending.id);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(sending);
    const toggles = enqueue(
      [entry({ kind: "tag", cardId: "c1", tag: bug, on: true })],
      entry({ kind: "tag", cardId: "c1", tag: bug, on: false }),
      "e-other"
    );
    expect(toggles).toHaveLength(1);
  });
});

describe("temporary ids", () => {
  it("maps a temporary card id to the real one", () => {
    const op: OutboxOp = { kind: "update", cardId: `${TEMP_PREFIX}a`, fields: { title: "x" } };
    expect(referencesTempId(op)).toBe(true);
    expect(resolveOp(op, {})).toEqual({ op, unresolved: true });
    expect(resolveOp(op, { [`${TEMP_PREFIX}a`]: "real" }).op).toMatchObject({ cardId: "real" });
  });

  it("splits titles like the server does", () => {
    expect(splitTitles(" one \n\n two\r\nthree ")).toEqual(["one", "two", "three"]);
  });
});

describe("replay", () => {
  function recorder(results: Record<string, RunResult | "throw"> = {}) {
    const calls: OutboxOp[] = [];
    let n = 0;
    const run = async (op: OutboxOp): Promise<RunResult> => {
      calls.push(op);
      n += 1;
      if (op.kind === "addCards") return { ok: true, createdIds: op.tempIds.map((_, i) => `real${n}-${i}`) };
      const r = results[op.cardId];
      if (r === "throw") throw new TypeError("Failed to fetch");
      return r ?? { ok: true };
    };
    return { calls, run };
  }

  it("sends entries in order and uses real ids for cards created offline", async () => {
    const temp = `${TEMP_PREFIX}x`;
    const entries = [
      entry({ kind: "move", cardId: "c1", toColumnId: "done", position: 0 }),
      entry({ kind: "addCards", columnId: "todo", titles: ["New"], tempIds: [temp] }),
      entry({ kind: "update", cardId: temp, fields: { title: "Renamed" } }),
      entry({ kind: "move", cardId: temp, toColumnId: "done", position: 1 }),
    ];
    const { calls, run } = recorder();
    const settled: string[] = [];
    const out = await replay(entries, {}, run, { onSettled: (e) => void settled.push(e.id) });
    expect(calls.map((c) => c.kind)).toEqual(["move", "addCards", "update", "move"]);
    expect(calls[2]).toMatchObject({ cardId: "real2-0" });
    expect(calls[3]).toMatchObject({ cardId: "real2-0" });
    expect(out.idMap).toEqual({ [temp]: "real2-0" });
    expect(out.synced).toHaveLength(4);
    expect(out.remaining).toEqual([]);
    expect(settled).toEqual(entries.map((e) => e.id));
  });

  it("drops rejected entries, reports them and continues", async () => {
    const entries = [
      entry({ kind: "update", cardId: "gone", fields: { title: "x" } }, "Deleted card"),
      entry({ kind: "update", cardId: "c2", fields: { title: "y" } }),
    ];
    const { calls, run } = recorder({ gone: { ok: false, error: "notFound" } });
    const out = await replay(entries, {}, run);
    expect(calls).toHaveLength(2);
    expect(out.failed).toEqual([{ entry: entries[0], error: "notFound" }]);
    expect(out.synced).toEqual([entries[1]]);
    expect(out.interrupted).toBe(false);
  });

  it("drops edits of a card whose creation never reached the server", async () => {
    const temp = `${TEMP_PREFIX}lost`;
    const entries = [entry({ kind: "update", cardId: temp, fields: { title: "x" } })];
    const { calls, run } = recorder();
    const out = await replay(entries, {}, run);
    expect(calls).toHaveLength(0);
    expect(out.failed[0].error).toBe("notFound");
  });

  it("stops on a network error and keeps the rest", async () => {
    const entries = [
      entry({ kind: "update", cardId: "c1", fields: { title: "x" } }),
      entry({ kind: "update", cardId: "offline", fields: { title: "y" } }),
      entry({ kind: "update", cardId: "c2", fields: { title: "z" } }),
    ];
    const { run } = recorder({ offline: "throw" });
    const out = await replay(entries, {}, run);
    expect(out.interrupted).toBe(true);
    expect(out.synced).toEqual([entries[0]]);
    expect(out.remaining).toEqual(entries.slice(1));
  });

  it("keeps entries on a retryable error (signed out)", async () => {
    const entries = [entry({ kind: "update", cardId: "c1", fields: { title: "x" } })];
    const { run } = recorder({ c1: { ok: false, error: "unauthorized" } });
    const out = await replay(entries, {}, run, { retryable: (e) => e === "unauthorized" });
    expect(out.interrupted).toBe(true);
    expect(out.remaining).toEqual(entries);
    expect(out.failed).toEqual([]);
  });
});

describe("applyOutbox", () => {
  it("applies moves, edits, assignees, tags and new cards", () => {
    const temp = `${TEMP_PREFIX}n`;
    const cols = applyOutbox(board(), [
      entry({ kind: "move", cardId: "c1", toColumnId: "done", position: 0 }),
      entry({ kind: "update", cardId: "c2", fields: { title: "Two!", priority: "high", deadline: "2026-12-01T00:00:00.000Z" } }),
      entry({ kind: "assignee", cardId: "c2", user: ann, on: true }),
      entry({ kind: "tag", cardId: "c3", tag: bug, on: true }),
      entry({ kind: "addCards", columnId: "todo", titles: ["Fresh"], tempIds: [temp] }),
      entry({ kind: "update", cardId: temp, fields: { title: "Fresher" } }),
    ]);
    expect(titles(cols)).toEqual([["Two!", "Fresher"], ["One", "Three"]]);
    const two = cols[0].cards[0];
    expect(two).toMatchObject({ priority: "high", deadline: "2026-12-01T00:00:00.000Z" });
    expect(two.assignees).toEqual([ann]);
    expect(cols[1].cards[1].tags).toEqual([bug]);
    expect(cols[0].cards[1].id).toBe(temp);
  });

  it("is idempotent, so synced entries can stay applied until fresh data arrives", () => {
    const temp = `${TEMP_PREFIX}n`;
    const entries = [
      entry({ kind: "addCards", columnId: "todo", titles: ["Fresh"], tempIds: [temp] }),
      entry({ kind: "assignee", cardId: "c1", user: ann, on: true }),
      entry({ kind: "move", cardId: "c2", toColumnId: "done", position: 0 }),
    ];
    const once = applyOutbox(board(), entries);
    expect(applyOutbox(once, entries)).toEqual(once);
    // The server data already contains the created card under its real id.
    const server = board();
    server[0].cards.push(blankCard("real", "Fresh", 2));
    const merged = applyOutbox(server, entries, { [temp]: "real" });
    expect(merged[0].cards.filter((c) => c.title === "Fresh")).toHaveLength(1);
  });

  it("updates the checklist and comment counts on the board card", () => {
    const base = board();
    base[0].cards[0] = { ...base[0].cards[0], subtasksTotal: 5, subtasksDone: 1, commentsCount: 2 };
    const entries = [
      entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: true, subtasksDone: 2 }),
      entry({ kind: "subtask", cardId: "c1", subtaskId: "s2", done: true, subtasksDone: 3 }),
      entry({ kind: "comment", cardId: "c1", tempId: "tmpc_a", body: "hi", commentsCount: 3 }),
    ];
    const once = applyOutbox(base, entries);
    expect(once[0].cards[0]).toMatchObject({ subtasksDone: 3, commentsCount: 3 });
    // Absolute counts: applying again, or on data that already has them, changes nothing.
    expect(applyOutbox(once, entries)).toEqual(once);
    // Never more than the card has, and entries without counts leave them alone.
    const capped = applyOutbox(base, [
      entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: true, subtasksDone: 9 }),
      entry({ kind: "subtask", cardId: "c2", subtaskId: "s9", done: true }),
      entry({ kind: "comment", cardId: "c2", tempId: "tmpc_b", body: "hi" }),
    ]);
    expect(capped[0].cards[0].subtasksDone).toBe(5);
    expect(capped[0].cards[1]).toBe(base[0].cards[1]);
  });

  it("keeps the latest count when a toggle of the same item is collapsed", () => {
    const base = board();
    base[0].cards[0] = { ...base[0].cards[0], subtasksTotal: 3, subtasksDone: 0 };
    let entries: OutboxEntry[] = [];
    entries = enqueue(entries, entry({ kind: "subtask", cardId: "c1", subtaskId: "a", done: true, subtasksDone: 1 }));
    entries = enqueue(entries, entry({ kind: "subtask", cardId: "c1", subtaskId: "b", done: true, subtasksDone: 2 }));
    entries = enqueue(entries, entry({ kind: "subtask", cardId: "c1", subtaskId: "a", done: false, subtasksDone: 1 }));
    expect(entries).toHaveLength(2);
    expect(applyOutbox(base, entries)[0].cards[0].subtasksDone).toBe(1);
  });

  it("ignores entries for cards or columns that no longer exist", () => {
    const before = board();
    const after = applyOutbox(before, [
      entry({ kind: "move", cardId: "missing", toColumnId: "done", position: 0 }),
      entry({ kind: "move", cardId: "c1", toColumnId: "missing", position: 0 }),
      entry({ kind: "addCards", columnId: "missing", titles: ["x"], tempIds: [`${TEMP_PREFIX}z`] }),
    ]);
    expect(after).toEqual(before);
  });
});
