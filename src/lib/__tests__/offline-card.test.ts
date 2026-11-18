import { describe, expect, it } from "vitest";
import {
  FULL_LIMITS,
  LITE_LIMITS,
  applyCardOutbox,
  newerCard,
  toOfflineCard,
  type OfflineCardRow,
  type StoredCard,
} from "@/lib/offline-card";
import {
  COMMENT_PREFIX,
  enqueue,
  referencesTempId,
  replay,
  resolveOp,
  type OutboxEntry,
  type OutboxOp,
  type RunResult,
} from "@/lib/outbox";

const ann = { id: "u1", username: "ann", displayName: "Ann", avatarUrl: null };
const bob = { id: "u2", username: "bob", displayName: null, avatarUrl: "/a.png" };

function row(overrides: Partial<OfflineCardRow> = {}): OfflineCardRow {
  return {
    id: "c1",
    title: "Card",
    description: "Hello",
    priority: "high",
    coverColor: null,
    deadline: new Date("2026-12-01T00:00:00.000Z"),
    column: { name: "To do", boardId: "b1" },
    assignees: [{ user: ann }],
    tags: [{ tagId: "t1" }],
    subtasks: [
      { id: "s1", title: "One", done: false, dueDate: new Date("2026-12-02T00:00:00.000Z"), assignee: bob },
      { id: "s2", title: "Two", done: true, dueDate: null, assignee: null },
    ],
    comments: [1, 2, 3, 4, 5].map((n) => ({
      id: `m${n}`,
      body: `Comment ${n}`,
      createdAt: new Date(Date.UTC(2026, 10, n)),
      author: n === 5 ? null : ann,
    })),
    attachments: [
      {
        id: "f1",
        fileName: "a.png",
        mimeType: "image/png",
        size: 10,
        createdAt: "2026-11-01T00:00:00.000Z",
        uploader: { username: "bob", displayName: null },
      },
    ],
    blocking: [{ blocked: { id: "c2", title: "Next" } }],
    blockedBy: [{ blocker: { id: "c0", title: "Before" } }],
    ...overrides,
  };
}

describe("toOfflineCard", () => {
  it("maps every field the card view shows", () => {
    const activity = [{ id: "a1", type: "created", data: {}, createdAt: "2026-11-01T00:00:00.000Z", actor: null }];
    const card = toOfflineCard(row(), FULL_LIMITS, activity);
    expect(card).toMatchObject({
      id: "c1",
      boardId: "b1",
      columnName: "To do",
      description: "Hello",
      descriptionTruncated: false,
      deadline: "2026-12-01T00:00:00.000Z",
      assignees: [ann],
      tagIds: ["t1"],
      commentsTotal: 5,
      activity,
      blocking: [{ cardId: "c2", title: "Next" }],
      blockedBy: [{ cardId: "c0", title: "Before" }],
    });
    expect(card.checklist).toEqual([
      { id: "s1", title: "One", done: false, dueDate: "2026-12-02", assigneeName: "bob" },
      { id: "s2", title: "Two", done: true, dueDate: null, assigneeName: null },
    ]);
    expect(card.comments.map((c) => c.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(card.comments[4].author).toBeNull();
    expect(card.attachments).toEqual([
      { id: "f1", fileName: "a.png", mimeType: "image/png", size: 10, createdAt: "2026-11-01T00:00:00.000Z", uploaderName: "bob" },
    ]);
  });

  it("keeps only the newest comments, cuts long text and drops history with the lightweight limits", () => {
    const long = "x".repeat(LITE_LIMITS.descriptionChars + 50);
    const card = toOfflineCard(row({ description: long, commentsTotal: 12 }), LITE_LIMITS, [
      { id: "a1", type: "created", data: {}, createdAt: "2026-11-01T00:00:00.000Z", actor: null },
    ]);
    expect(card.comments.map((c) => c.id)).toEqual(["m3", "m4", "m5"]);
    expect(card.commentsTotal).toBe(12);
    expect(card.activity).toEqual([]);
    expect(card.descriptionTruncated).toBe(true);
    expect(card.description.length).toBeLessThanOrEqual(LITE_LIMITS.descriptionChars + 3);
  });

  it("does not leak fields it was not asked for", () => {
    const withSecret = { ...row(), assignees: [{ user: { ...ann, email: "ann@example.com", passwordHash: "h" } }] };
    const card = toOfflineCard(withSecret);
    expect(JSON.stringify(card)).not.toContain("passwordHash");
    expect(JSON.stringify(card)).not.toContain("ann@example.com");
  });

  it("handles an empty description and no deadline", () => {
    const card = toOfflineCard(row({ description: null, deadline: null }));
    expect(card.description).toBe("");
    expect(card.deadline).toBeNull();
  });
});

describe("newerCard", () => {
  const base = { card: toOfflineCard(row()), members: [], tags: [] };
  const full: StoredCard = { ...base, renderedAt: "2026-11-02T00:00:00.000Z", partial: false };
  const lite: StoredCard = { ...base, renderedAt: "2026-11-03T00:00:00.000Z", partial: true };

  it("picks the newer copy, or the complete one on a tie", () => {
    expect(newerCard(full, lite)).toBe(lite);
    expect(newerCard(full, { ...lite, renderedAt: full.renderedAt })).toBe(full);
    expect(newerCard({ ...lite, renderedAt: full.renderedAt }, full)).toBe(full);
    expect(newerCard(undefined, full)).toBe(full);
    expect(newerCard(full, undefined)).toBe(full);
  });
});

let seq = 0;
function entry(op: OutboxOp): OutboxEntry {
  seq += 1;
  return { id: `e${seq}`, boardId: "b1", createdAt: Date.UTC(2026, 10, 10, 0, seq), label: "Card", op };
}

describe("card outbox operations", () => {
  it("keeps only the latest checklist toggle per item", () => {
    let list = enqueue([], entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: true }));
    list = enqueue(list, entry({ kind: "subtask", cardId: "c1", subtaskId: "s2", done: true }));
    list = enqueue(list, entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: false }));
    expect(list.map((e) => e.op)).toEqual([
      { kind: "subtask", cardId: "c1", subtaskId: "s2", done: true },
      { kind: "subtask", cardId: "c1", subtaskId: "s1", done: false },
    ]);
  });

  it("does not replace a checklist toggle that is being sent", () => {
    const sending = entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: true });
    const list = enqueue([sending], entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: false }), sending.id);
    expect(list).toHaveLength(2);
  });

  it("never merges comments", () => {
    let list = enqueue([], entry({ kind: "comment", cardId: "c1", tempId: `${COMMENT_PREFIX}1`, body: "a" }));
    list = enqueue(list, entry({ kind: "comment", cardId: "c1", tempId: `${COMMENT_PREFIX}2`, body: "a" }));
    expect(list).toHaveLength(2);
  });

  it("maps a card created offline to its real id before sending a comment or toggle", () => {
    const op: OutboxOp = { kind: "comment", cardId: "tmp_x", tempId: `${COMMENT_PREFIX}1`, body: "hi" };
    expect(referencesTempId(op)).toBe(true);
    expect(resolveOp(op, { tmp_x: "real" })).toEqual({ op: { ...op, cardId: "real" }, unresolved: false });
  });

  it("replays comments in order and reports a rejected one", async () => {
    const sent: OutboxOp[] = [];
    const run = async (op: OutboxOp): Promise<RunResult> => {
      sent.push(op);
      return op.kind === "comment" && op.body === "gone" ? { ok: false, error: "notFound" } : { ok: true };
    };
    const a = entry({ kind: "comment", cardId: "c1", tempId: `${COMMENT_PREFIX}1`, body: "first" });
    const b = entry({ kind: "comment", cardId: "c9", tempId: `${COMMENT_PREFIX}2`, body: "gone" });
    const c = entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: true });
    const out = await replay([a, b, c], {}, run);
    expect(sent.map((op) => op.kind)).toEqual(["comment", "comment", "subtask"]);
    expect(out.synced.map((e) => e.id)).toEqual([a.id, c.id]);
    expect(out.failed).toEqual([{ entry: b, error: "notFound" }]);
  });

  it("keeps a comment for later when the network fails", async () => {
    const a = entry({ kind: "comment", cardId: "c1", tempId: `${COMMENT_PREFIX}1`, body: "first" });
    const out = await replay([a], {}, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(out.interrupted).toBe(true);
    expect(out.remaining).toEqual([a]);
  });
});

describe("applyCardOutbox", () => {
  const card = toOfflineCard(row());

  it("applies queued field, assignee, tag and checklist edits of this card only", () => {
    const view = applyCardOutbox(card, [
      entry({ kind: "update", cardId: "c1", fields: { title: "Renamed", priority: "low", deadline: null } }),
      entry({ kind: "assignee", cardId: "c1", user: bob, on: true }),
      entry({ kind: "assignee", cardId: "c1", user: ann, on: false }),
      entry({ kind: "tag", cardId: "c1", tag: { id: "t1", name: "Bug", color: "#f00" }, on: false }),
      entry({ kind: "tag", cardId: "c1", tag: { id: "t2", name: "Ops", color: "#0f0" }, on: true }),
      entry({ kind: "subtask", cardId: "c1", subtaskId: "s1", done: true }),
      entry({ kind: "update", cardId: "other", fields: { title: "Nope" } }),
      entry({ kind: "move", cardId: "c1", toColumnId: "done", position: 0 }),
    ]);
    expect(view.card.title).toBe("Renamed");
    expect(view.card.priority).toBe("low");
    expect(view.card.deadline).toBeNull();
    expect(view.card.assignees).toEqual([bob]);
    expect(view.card.tagIds).toEqual(["t2"]);
    expect(view.card.checklist.map((i) => i.done)).toEqual([true, true]);
    expect(view.pendingComments).toEqual([]);
  });

  it("is a no-op for edits the stored data already reflects", () => {
    const view = applyCardOutbox(card, [
      entry({ kind: "assignee", cardId: "c1", user: ann, on: true }),
      entry({ kind: "tag", cardId: "c1", tag: { id: "t1", name: "Bug", color: "#f00" }, on: true }),
    ]);
    expect(view.card).toEqual(card);
  });

  it("lists queued comments as pending, in order", () => {
    const a = entry({ kind: "comment", cardId: "c1", tempId: `${COMMENT_PREFIX}a`, body: "one" });
    const b = entry({ kind: "comment", cardId: "c1", tempId: `${COMMENT_PREFIX}b`, body: "two" });
    const view = applyCardOutbox(card, [a, entry({ kind: "comment", cardId: "c2", tempId: "x", body: "no" }), b]);
    expect(view.pendingComments).toEqual([
      { id: `${COMMENT_PREFIX}a`, body: "one", createdAt: new Date(a.createdAt).toISOString() },
      { id: `${COMMENT_PREFIX}b`, body: "two", createdAt: new Date(b.createdAt).toISOString() },
    ]);
    expect(view.card.comments).toEqual(card.comments);
  });

  it("follows a temporary card id to the real one", () => {
    const view = applyCardOutbox(card, [entry({ kind: "update", cardId: "tmp_1", fields: { title: "Mapped" } })], {
      tmp_1: "c1",
    });
    expect(view.card.title).toBe("Mapped");
  });
});
