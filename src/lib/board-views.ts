import type { CardDTO } from "@/components/board/types";

// Pure helpers for the board's List and Calendar views. Dates are handled as
// "YYYY-MM-DD" keys: deadlines are calendar dates stored as UTC midnight, so
// their key is the UTC date, while "today" is the viewer's local date (the
// same convention as src/lib/deadline.ts).

export type BoardView = "board" | "list" | "calendar";
export const BOARD_VIEWS: BoardView[] = ["board", "list", "calendar"];

export function parseView(value: string | null | undefined): BoardView {
  return value === "list" || value === "calendar" ? value : "board";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date of `date` as YYYY-MM-DD. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The calendar date of a stored deadline (UTC midnight) as YYYY-MM-DD. */
export function deadlineKey(iso: string): string {
  return iso.slice(0, 10);
}

/** A YYYY-MM-DD key as a Date at UTC midnight (how deadlines are stored). */
export function keyToUtcDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key: string, days: number): string {
  const d = keyToUtcDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Month {
  year: number;
  /** 0-based, like Date#getMonth. */
  month: number;
}

export function monthOf(key: string): Month {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function shiftMonth({ year, month }: Month, delta: number): Month {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * Weeks of a month view, each a list of 7 YYYY-MM-DD keys. Weeks start on
 * Monday in every locale (ISO 8601; also what en-GB, our English locale,
 * uses), and include the days of the neighbouring months needed to fill them.
 */
export function monthGrid({ year, month }: Month): string[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // days since Monday
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const start = addDays(first.toISOString().slice(0, 10), -lead);
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export function inMonth(key: string, { year, month }: Month): boolean {
  const m = monthOf(key);
  return m.year === year && m.month === month;
}

/** Cards with a deadline, grouped by date key, in board order. */
export function cardsByDay<T extends Pick<CardDTO, "deadline">>(cards: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const card of cards) {
    if (!card.deadline) continue;
    const key = deadlineKey(card.deadline);
    const list = map.get(key);
    if (list) list.push(card);
    else map.set(key, [card]);
  }
  return map;
}

export type QuickPick = "today" | "tomorrow" | "nextWeek";

/** The date a deadline quick pick stands for, relative to `now` (local). */
export function quickPickDate(pick: QuickPick, now: Date): string {
  const today = dateKey(now);
  return pick === "today" ? today : addDays(today, pick === "tomorrow" ? 1 : 7);
}

// ---------- List view sorting ----------

export type SortKey = "title" | "column" | "assignees" | "priority" | "deadline" | "subtasks";
export type SortDirection = "ascending" | "descending";

export interface ListRow {
  card: CardDTO;
  columnName: string;
  /** Position of the card's column on the board. */
  columnIndex: number;
}

const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, critical: 3 };

const nameOf = (u: CardDTO["assignees"][number]) => u.displayName ?? u.username;

/**
 * Sorted copy of the rows. Rows without a value for the key (no deadline, no
 * assignees, no subtasks) always go last, whichever the direction. Ties keep
 * board order (column, then position in the column).
 */
export function sortRows(rows: ListRow[], key: SortKey, direction: SortDirection, locale: string): ListRow[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const boardOrder = (a: ListRow, b: ListRow) => a.columnIndex - b.columnIndex || a.card.position - b.card.position;
  const value = (row: ListRow): string | number | null => {
    const c = row.card;
    switch (key) {
      case "title":
        return c.title;
      case "column":
        return row.columnIndex;
      case "assignees":
        return c.assignees.length ? c.assignees.map(nameOf).sort(collator.compare).join(", ") : null;
      case "priority":
        return PRIORITY_RANK[c.priority] ?? 1;
      case "deadline":
        return c.deadline ? deadlineKey(c.deadline) : null;
      case "subtasks":
        return c.subtasksTotal ? c.subtasksDone / c.subtasksTotal : null;
    }
  };
  const sign = direction === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) {
      if (va === vb) return boardOrder(a, b);
      return va === null ? 1 : -1;
    }
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
    return cmp !== 0 ? cmp * sign : boardOrder(a, b);
  });
}
