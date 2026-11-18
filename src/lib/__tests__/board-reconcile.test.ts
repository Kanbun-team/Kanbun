import { describe, expect, it } from "vitest";
import { reconcileColumns } from "@/components/board/reconcile";
import type { CardDTO, ColumnDTO } from "@/components/board/types";

const card = (id: string, extra: Partial<CardDTO> = {}): CardDTO => ({
  id,
  title: `Card ${id}`,
  priority: "normal",
  coverColor: null,
  deadline: null,
  position: 0,
  assignees: [{ id: "u1", displayName: "Ada", username: "ada", avatarUrl: null }],
  tags: [{ id: "t1", name: "Bug", color: "#dc2626" }],
  subtasksTotal: 0,
  subtasksDone: 0,
  commentsCount: 0,
  blockedByCount: 0,
  attachmentsCount: 0,
  ...extra,
});
const column = (id: string, cards: CardDTO[], extra: Partial<ColumnDTO> = {}): ColumnDTO => ({
  id,
  name: `Column ${id}`,
  position: 0,
  wipLimit: null,
  cards,
  ...extra,
});
// A fresh deep copy, like the data a router.refresh() brings.
const copy = (columns: ColumnDTO[]): ColumnDTO[] => JSON.parse(JSON.stringify(columns));

describe("reconcileColumns", () => {
  const prev = [column("a", [card("1"), card("2")]), column("b", [card("3")])];

  it("returns the previous array when nothing changed", () => {
    expect(reconcileColumns(prev, copy(prev))).toBe(prev);
  });

  it("keeps unchanged cards and columns, replaces changed ones", () => {
    const next = copy(prev);
    next[0].cards[1].title = "Renamed";
    const result = reconcileColumns(prev, next);
    expect(result).not.toBe(prev);
    expect(result).toEqual(next);
    expect(result[0]).not.toBe(prev[0]);
    expect(result[0].cards[0]).toBe(prev[0].cards[0]);
    expect(result[0].cards[1]).not.toBe(prev[0].cards[1]);
    expect(result[1]).toBe(prev[1]);
  });

  it("notices changes in assignees, tags and counts", () => {
    for (const change of [
      (c: CardDTO) => (c.assignees = []),
      (c: CardDTO) => (c.tags[0].color = "#000000"),
      (c: CardDTO) => (c.commentsCount = 4),
      (c: CardDTO) => (c.deadline = "2026-12-01T00:00:00.000Z"),
    ]) {
      const next = copy(prev);
      change(next[1].cards[0]);
      const result = reconcileColumns(prev, next);
      expect(result[1].cards[0]).not.toBe(prev[1].cards[0]);
      expect(result[1].cards[0]).toEqual(next[1].cards[0]);
    }
  });

  it("reuses a card moved to another column", () => {
    const next = copy(prev);
    next[1].cards.unshift(next[0].cards.shift()!);
    const result = reconcileColumns(prev, next);
    expect(result[1].cards[0]).toBe(prev[0].cards[0]);
    expect(result[0]).not.toBe(prev[0]);
    expect(result[1]).not.toBe(prev[1]);
  });

  it("handles added and removed columns", () => {
    const next = [...copy(prev), column("c", [])];
    expect(reconcileColumns(prev, next)).toHaveLength(3);
    expect(reconcileColumns(prev, copy(prev).slice(1))).toEqual([prev[1]]);
    expect(reconcileColumns(prev, copy(prev).slice(1))[0]).toBe(prev[1]);
  });

  it("notices column renames and WIP limit changes", () => {
    const next = copy(prev);
    next[0].wipLimit = 3;
    expect(reconcileColumns(prev, next)[0]).toEqual(next[0]);
    expect(reconcileColumns(prev, next)[0]).not.toBe(prev[0]);
  });
});
