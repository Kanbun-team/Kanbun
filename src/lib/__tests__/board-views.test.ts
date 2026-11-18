import { describe, expect, it } from "vitest";
import {
  addDays,
  cardsByDay,
  dateKey,
  inMonth,
  monthGrid,
  parseView,
  quickPickDate,
  shiftMonth,
  sortRows,
  type ListRow,
} from "@/lib/board-views";
import { parseFilters } from "@/lib/board-filters";
import type { CardDTO } from "@/components/board/types";

function card(id: string, over: Partial<CardDTO> = {}): CardDTO {
  return {
    id,
    title: id,
    priority: "normal",
    coverColor: null,
    deadline: null,
    position: 0,
    assignees: [],
    tags: [],
    subtasksTotal: 0,
    subtasksDone: 0,
    commentsCount: 0,
    blockedByCount: 0,
    attachmentsCount: 0,
    ...over,
  };
}

const row = (c: CardDTO, columnIndex = 0): ListRow => ({ card: c, columnName: `Col ${columnIndex}`, columnIndex });
const ids = (rows: ListRow[]) => rows.map((r) => r.card.id);

describe("calendar date math", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("uses the local calendar date for today", () => {
    expect(dateKey(new Date(2026, 10, 18, 23, 59))).toBe("2026-11-18");
    expect(dateKey(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  it("builds Monday-first month grids with whole weeks", () => {
    // November 2026 starts on a Sunday and has 30 days: 6 weeks.
    const nov = monthGrid({ year: 2026, month: 10 });
    expect(nov).toHaveLength(6);
    expect(nov[0][0]).toBe("2026-10-26");
    expect(nov[0][6]).toBe("2026-11-01");
    expect(nov[5][6]).toBe("2026-12-06");
    expect(nov.every((w) => w.length === 7)).toBe(true);
    // February 2027 starts on a Monday and has 28 days: exactly 4 weeks.
    const feb = monthGrid({ year: 2027, month: 1 });
    expect(feb).toHaveLength(4);
    expect(feb[0][0]).toBe("2027-02-01");
    expect(feb[3][6]).toBe("2027-02-28");
  });

  it("moves between months and years", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 5 }, -18)).toEqual({ year: 2024, month: 11 });
    expect(inMonth("2026-11-30", { year: 2026, month: 10 })).toBe(true);
    expect(inMonth("2026-12-01", { year: 2026, month: 10 })).toBe(false);
  });

  it("groups cards by the UTC date of their deadline", () => {
    const map = cardsByDay([
      card("a", { deadline: "2026-11-20T00:00:00.000Z" }),
      card("b"),
      card("c", { deadline: "2026-11-20T15:00:00.000Z" }),
      card("d", { deadline: "2026-11-21T00:00:00.000Z" }),
    ]);
    expect(map.get("2026-11-20")?.map((c) => c.id)).toEqual(["a", "c"]);
    expect(map.get("2026-11-21")?.map((c) => c.id)).toEqual(["d"]);
    expect(map.size).toBe(2);
  });

  it("resolves deadline quick picks", () => {
    const now = new Date(2026, 11, 30, 18, 0);
    expect(quickPickDate("today", now)).toBe("2026-12-30");
    expect(quickPickDate("tomorrow", now)).toBe("2026-12-31");
    expect(quickPickDate("nextWeek", now)).toBe("2027-01-06");
  });

  it("parses the view from the URL", () => {
    expect(parseView("list")).toBe("list");
    expect(parseView("calendar")).toBe("calendar");
    expect(parseView(null)).toBe("board");
    expect(parseView("nonsense")).toBe("board");
  });
});

describe("list sorting", () => {
  const rows = [
    row(card("late", { title: "Zebra", deadline: "2026-11-10T00:00:00.000Z", priority: "critical", position: 0 }), 1),
    row(card("none", { title: "alpha", position: 1 }), 1),
    row(card("soon", { title: "Mango", deadline: "2026-11-20T00:00:00.000Z", priority: "low", position: 0 }), 0),
    row(card("later", { title: "beta", deadline: "2026-12-01T00:00:00.000Z", priority: "high", position: 1 }), 0),
  ];

  it("sorts by deadline with cards without one last in both directions", () => {
    expect(ids(sortRows(rows, "deadline", "ascending", "en"))).toEqual(["late", "soon", "later", "none"]);
    expect(ids(sortRows(rows, "deadline", "descending", "en"))).toEqual(["later", "soon", "late", "none"]);
  });

  it("sorts titles case-insensitively", () => {
    expect(ids(sortRows(rows, "title", "ascending", "en"))).toEqual(["none", "later", "soon", "late"]);
  });

  it("sorts priority by rank, not by name", () => {
    expect(ids(sortRows(rows, "priority", "descending", "en"))).toEqual(["late", "later", "none", "soon"]);
  });

  it("sorts by column, keeping card order inside a column", () => {
    expect(ids(sortRows(rows, "column", "ascending", "en"))).toEqual(["soon", "later", "late", "none"]);
    expect(ids(sortRows(rows, "column", "descending", "en"))).toEqual(["late", "none", "soon", "later"]);
  });

  it("sorts subtasks by progress", () => {
    const sub = [
      row(card("half", { subtasksTotal: 4, subtasksDone: 2 })),
      row(card("empty")),
      row(card("done", { subtasksTotal: 1, subtasksDone: 1 })),
    ];
    expect(ids(sortRows(sub, "subtasks", "descending", "en"))).toEqual(["done", "half", "empty"]);
  });

  it("does not mutate its input", () => {
    const before = ids(rows);
    sortRows(rows, "title", "descending", "en");
    expect(ids(rows)).toEqual(before);
  });
});

describe("saved filter JSON", () => {
  it("accepts valid filters and fills missing fields", () => {
    expect(parseFilters('{"deadline":"none"}')).toEqual({
      query: "",
      assigneeId: "",
      tagId: "",
      priority: "",
      deadline: "none",
      mine: false,
    });
  });

  it("rejects malformed or invalid JSON", () => {
    expect(parseFilters("not json")).toBeNull();
    expect(parseFilters('{"deadline":"someday"}')).toBeNull();
    expect(parseFilters('{"mine":"yes"}')).toBeNull();
  });
});
