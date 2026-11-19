import { describe, expect, it } from "vitest";
import { applyOutbox, blankCard, type OutboxEntry, type OutboxOp } from "@/lib/outbox";
import {
  NO_LANE,
  blankLane,
  buildLanes,
  cardLanes,
  cellKey,
  columnIndexFor,
  groupCells,
  isCellKey,
  laneChange,
  parseCell,
  parseGroup,
  shareCells,
} from "@/lib/swimlanes";
import type { CardDTO, ColumnDTO, MemberOption, TagOption } from "@/components/board/types";

const ana: MemberOption = { id: "u-ana", displayName: "Ana", username: "ana", avatarUrl: null };
const bo: MemberOption = { id: "u-bo", displayName: null, username: "bo", avatarUrl: null };
const cy: MemberOption = { id: "u-cy", displayName: "Cy", username: "cy", avatarUrl: null };
const gone: MemberOption = { id: "u-gone", displayName: "Zed", username: "zed", avatarUrl: null };
const bug: TagOption = { id: "t-bug", name: "Bug", color: "#b4321f" };
const ui: TagOption = { id: "t-ui", name: "UI", color: "#2b4c9b" };
const ops: TagOption = { id: "t-ops", name: "Ops", color: "#1f7a4d" };

function card(id: string, extra: Partial<CardDTO> = {}): CardDTO {
  return { ...blankCard(id, `Card ${id}`, 0), ...extra };
}

describe("parseGroup", () => {
  it("accepts the three groupings and falls back to none", () => {
    expect(parseGroup("assignee")).toBe("assignee");
    expect(parseGroup("priority")).toBe("priority");
    expect(parseGroup("tag")).toBe("tag");
    expect(parseGroup("column")).toBe("none");
    expect(parseGroup(null)).toBe("none");
  });
});

describe("buildLanes", () => {
  it("orders priorities from critical to low, with no empty lane", () => {
    expect(buildLanes("priority", [], [], []).map((l) => l.key)).toEqual(["critical", "high", "normal", "low"]);
  });

  it("sorts members by name, adds assignees who left the board, ends with No assignee", () => {
    const lanes = buildLanes("assignee", [cy, bo, ana], [], [card("a", { assignees: [gone] })]);
    expect(lanes.map((l) => l.key)).toEqual(["u-ana", "u-bo", "u-cy", "u-gone", NO_LANE]);
  });

  it("keeps the board's tag order and ends with No tag", () => {
    expect(buildLanes("tag", [], [ui, bug], []).map((l) => l.key)).toEqual(["t-ui", "t-bug", NO_LANE]);
  });

  it("has no lanes without grouping", () => {
    expect(buildLanes("none", [ana], [bug], [])).toEqual([]);
  });
});

describe("cardLanes", () => {
  const lanes = buildLanes("tag", [], [bug, ui, ops], []);
  const order = new Map(lanes.map((l, i) => [l.key, i]));

  it("puts a card with several tags in the first one in lane order, with copies in the others", () => {
    expect(cardLanes(card("a", { tags: [ops, bug] }), "tag", order)).toEqual({ primary: "t-bug", copies: ["t-ops"] });
  });

  it("puts a card without tags in No tag", () => {
    expect(cardLanes(card("a"), "tag", order)).toEqual({ primary: NO_LANE, copies: [] });
  });

  it("reads the priority, unknown values count as normal", () => {
    const p = new Map(buildLanes("priority", [], [], []).map((l, i) => [l.key, i]));
    expect(cardLanes(card("a", { priority: "high" }), "priority", p).primary).toBe("high");
    expect(cardLanes(card("a", { priority: "urgent" }), "priority", p).primary).toBe("normal");
  });
});

describe("cells", () => {
  it("round-trips cell keys", () => {
    const key = cellKey("col1", "u-ana");
    expect(isCellKey(key)).toBe(true);
    expect(isCellKey("col:col1")).toBe(false);
    expect(parseCell(key)).toEqual({ lane: "u-ana", columnId: "col1" });
    expect(parseCell("card-id")).toBeNull();
  });

  const a = card("a", { assignees: [bo] });
  const b = card("b", { assignees: [ana, bo] });
  const c = card("c");
  const columns: ColumnDTO[] = [
    { id: "todo", name: "To do", position: 0, wipLimit: null, cards: [a, b, c] },
    { id: "done", name: "Done", position: 1, wipLimit: 2, cards: [] },
  ];
  const lanes = buildLanes("assignee", [ana, bo], [], []);

  it("groups cards by column and lane, in column order, with copies", () => {
    const { cells, cellOf } = groupCells(columns, lanes, "assignee");
    expect(cells.get(cellKey("todo", "u-ana"))!.cards).toEqual([b]);
    expect(cells.get(cellKey("todo", "u-bo"))!.cards).toEqual([a]);
    expect(cells.get(cellKey("todo", "u-bo"))!.copies).toEqual([{ card: b, from: "u-ana" }]);
    expect(cells.get(cellKey("todo", NO_LANE))!.cards).toEqual([c]);
    expect(cells.get(cellKey("done", "u-ana"))!.cards).toEqual([]);
    expect(cellOf.get("b")).toBe(cellKey("todo", "u-ana"));
  });

  it("keeps a dragged card in the lane it was dragged to, without a copy there", () => {
    const { cells, cellOf } = groupCells(columns, lanes, "assignee", { cardId: "b", lane: "u-bo" });
    expect(cellOf.get("b")).toBe(cellKey("todo", "u-bo"));
    expect(cells.get(cellKey("todo", "u-bo"))!.cards).toEqual([a, b]);
    expect(cells.get(cellKey("todo", "u-bo"))!.copies).toEqual([]);
    expect(cells.get(cellKey("todo", "u-ana"))!.cards).toEqual([]);
  });

  it("keeps unchanged cells as the same objects", () => {
    const before = groupCells(columns, lanes, "assignee");
    const moved = columns.map((col) =>
      col.id === "todo" ? { ...col, cards: [a, c, b] } : col
    );
    const after = shareCells(before, groupCells(moved, lanes, "assignee"));
    expect(after.cells.get(cellKey("done", "u-ana"))).toBe(before.cells.get(cellKey("done", "u-ana")));
    expect(after.cells.get(cellKey("todo", "u-ana"))).toBe(before.cells.get(cellKey("todo", "u-ana")));
    expect(shareCells(before, groupCells(columns, lanes, "assignee")).cells).toBe(before.cells);
  });
});

describe("columnIndexFor", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => card(id));
  // Column a b c d; the cell holds b and d.
  it("goes before the cell card at that index", () => {
    expect(columnIndexFor([a, b, c, d], [b, d], 0)).toBe(1);
    expect(columnIndexFor([a, b, c, d], [b, d], 1)).toBe(3);
  });
  it("goes after the last card of the cell at the end", () => {
    expect(columnIndexFor([a, b, c, d], [b, d], 2)).toBe(4);
    expect(columnIndexFor([a, b, c, d], [a, b], 2)).toBe(2);
  });
  it("keeps its place or goes to the end of the column in an empty cell", () => {
    expect(columnIndexFor([a, b, c], [], 0, 1)).toBe(1);
    expect(columnIndexFor([a, b, c], [], 0)).toBe(3);
  });
});

describe("laneChange", () => {
  const assigneeLanes = buildLanes("assignee", [ana, bo, cy], [], []);
  const tagLanes = buildLanes("tag", [], [bug, ui, ops], []);

  it("sets the priority", () => {
    const c = card("a", { priority: "low" });
    expect(laneChange(c, "priority", "low", "critical", [])).toEqual({
      patch: { priority: "critical" },
      ops: [{ kind: "update", cardId: "a", fields: { priority: "critical" } }],
    });
  });

  it("does nothing within the same lane or without grouping", () => {
    expect(laneChange(card("a"), "assignee", "u-ana", "u-ana", assigneeLanes)).toEqual({ patch: {}, ops: [] });
    expect(laneChange(card("a"), "none", "x", "y", [])).toEqual({ patch: {}, ops: [] });
  });

  it("replaces the lane's assignee and keeps the others", () => {
    const c = card("a", { assignees: [ana, cy] });
    const change = laneChange(c, "assignee", "u-ana", "u-bo", assigneeLanes);
    expect(change.patch.assignees).toEqual([cy, bo]);
    expect(change.ops).toEqual([
      { kind: "assignee", cardId: "a", user: ana, on: false },
      { kind: "assignee", cardId: "a", user: bo, on: true },
    ]);
  });

  it("does not add an assignee the card already has", () => {
    const c = card("a", { assignees: [ana, bo] });
    const change = laneChange(c, "assignee", "u-ana", "u-bo", assigneeLanes);
    expect(change.patch.assignees).toEqual([bo]);
    expect(change.ops).toEqual([{ kind: "assignee", cardId: "a", user: ana, on: false }]);
  });

  it("assigns a card from No assignee", () => {
    const change = laneChange(card("a"), "assignee", NO_LANE, "u-cy", assigneeLanes);
    expect(change.patch.assignees).toEqual([cy]);
    expect(change.ops).toEqual([{ kind: "assignee", cardId: "a", user: cy, on: true }]);
  });

  it("removes every tag in No tag", () => {
    const c = card("a", { tags: [bug, ops] });
    const change = laneChange(c, "tag", "t-bug", NO_LANE, tagLanes);
    expect(change.patch.tags).toEqual([]);
    expect(change.ops).toEqual([
      { kind: "tag", cardId: "a", tag: bug, on: false },
      { kind: "tag", cardId: "a", tag: ops, on: false },
    ]);
  });

  it("swaps one tag for another", () => {
    const change = laneChange(card("a", { tags: [bug, ops] }), "tag", "t-bug", "t-ui", tagLanes);
    expect(change.patch.tags).toEqual([ops, ui]);
  });

  it("ignores a lane that does not exist (any more)", () => {
    expect(laneChange(card("a"), "tag", NO_LANE, "t-deleted", tagLanes)).toEqual({ patch: {}, ops: [] });
  });

  it("starts new cards in No assignee, No tag or Normal", () => {
    expect(blankLane("assignee")).toBe(NO_LANE);
    expect(blankLane("tag")).toBe(NO_LANE);
    expect(blankLane("priority")).toBe("normal");
  });

  it("gives the same result when its operations are replayed from the offline outbox", () => {
    const c = card("a", { assignees: [ana, cy] });
    const columns: ColumnDTO[] = [{ id: "todo", name: "To do", position: 0, wipLimit: null, cards: [c] }];
    const change = laneChange(c, "assignee", "u-ana", "u-bo", assigneeLanes);
    const move: OutboxOp = { kind: "move", cardId: "a", toColumnId: "todo", position: 0 };
    const entries: OutboxEntry[] = [move, ...change.ops].map((op, i) => ({
      id: String(i),
      boardId: "b",
      createdAt: i,
      label: c.title,
      op,
    }));
    const after = applyOutbox(columns, entries)[0].cards[0];
    expect(after.assignees.map((u) => u.id).sort()).toEqual(["u-bo", "u-cy"]);
    const order = new Map(assigneeLanes.map((l, i) => [l.key, i]));
    expect(cardLanes(after, "assignee", order)).toEqual({ primary: "u-bo", copies: ["u-cy"] });
  });
});
