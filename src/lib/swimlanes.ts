// Swimlanes: the board grouped into horizontal lanes by assignee, priority or
// tag. Pure logic only (no React, no DOM), so it can be unit tested; the
// board component is src/components/board/Swimlanes.tsx.
//
// Rules:
// - Lanes come in a fixed order: priority from Critical to Low; assignees by
//   name (board members, then anyone else assigned to a card); tags in the
//   board's tag order. Assignee and tag lanes end with "No assignee" / "No
//   tag". Priority has no empty lane: every card has one.
// - A card with several assignees or tags is in the lane of the first one in
//   lane order. That is where it can be dragged from. Every other lane it
//   belongs to shows a read-only copy that links to the card.
// - Moving a card from lane A to lane B replaces A with B: it loses A, gains B
//   and keeps its other assignees or tags. Moving it to "No assignee" or "No
//   tag" removes all of them. A priority lane sets the priority.

import type { CardDTO, CardPatch, ColumnDTO, MemberOption, TagOption } from "@/components/board/types";
import type { OutboxOp } from "@/lib/outbox";

export type GroupBy = "none" | "assignee" | "priority" | "tag";
export const GROUPS: GroupBy[] = ["none", "assignee", "priority", "tag"];

/** The key of the "No assignee" and "No tag" lanes. */
export const NO_LANE = "none";

/** Lane order of the priorities, most urgent first. */
export const PRIORITY_LANES = ["critical", "high", "normal", "low"] as const;

export function parseGroup(value: string | null | undefined): GroupBy {
  return value === "assignee" || value === "priority" || value === "tag" ? value : "none";
}

export type Lane =
  | { key: string; kind: "assignee"; member: MemberOption }
  | { key: string; kind: "tag"; tag: TagOption }
  | { key: string; kind: "priority"; priority: string }
  | { key: typeof NO_LANE; kind: "none" };

const nameOf = (m: MemberOption) => m.displayName ?? m.username;

/**
 * The lanes for a grouping, in order. Assignees who are no longer board
 * members but still on cards get a lane too, so no card is left without one.
 */
export function buildLanes(
  group: GroupBy,
  members: MemberOption[],
  tags: TagOption[],
  cards: CardDTO[],
  intlLocale = "en"
): Lane[] {
  if (group === "priority") return PRIORITY_LANES.map((p) => ({ key: p, kind: "priority", priority: p }));
  if (group === "tag") {
    const known = new Map(tags.map((tg) => [tg.id, tg]));
    for (const card of cards) for (const tg of card.tags) if (!known.has(tg.id)) known.set(tg.id, tg);
    return [...[...known.values()].map((tag): Lane => ({ key: tag.id, kind: "tag", tag })), { key: NO_LANE, kind: "none" }];
  }
  if (group === "assignee") {
    const collator = new Intl.Collator(intlLocale, { sensitivity: "base", numeric: true });
    const byName = (a: MemberOption, b: MemberOption) => collator.compare(nameOf(a), nameOf(b)) || a.id.localeCompare(b.id);
    const inBoard = new Map(members.map((m) => [m.id, m]));
    const others = new Map<string, MemberOption>();
    for (const card of cards) for (const u of card.assignees) if (!inBoard.has(u.id)) others.set(u.id, u);
    return [
      ...[...inBoard.values()].sort(byName).map((member): Lane => ({ key: member.id, kind: "assignee", member })),
      ...[...others.values()].sort(byName).map((member): Lane => ({ key: member.id, kind: "assignee", member })),
      { key: NO_LANE, kind: "none" },
    ];
  }
  return [];
}

/** The lane keys a card belongs to, in no particular order (NO_LANE when it has no value). */
export function laneValues(card: CardDTO, group: GroupBy): string[] {
  if (group === "priority") return [PRIORITY_LANES.includes(card.priority as never) ? card.priority : "normal"];
  const ids = group === "assignee" ? card.assignees.map((u) => u.id) : group === "tag" ? card.tags.map((tg) => tg.id) : [];
  return ids.length > 0 ? ids : [NO_LANE];
}

/**
 * The lane the card is moved from (`primary`) and the lanes with a read-only
 * copy, both following lane order. Values without a lane are ignored.
 */
export function cardLanes(card: CardDTO, group: GroupBy, order: Map<string, number>): { primary: string; copies: string[] } {
  const keys = laneValues(card, group)
    .filter((k) => order.has(k))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  if (keys.length === 0) return { primary: NO_LANE, copies: [] };
  return { primary: keys[0], copies: keys.slice(1) };
}

// ---------- Cells: one per column and lane ----------

const CELL_PREFIX = "cell:";

/** The drop target id of a column's part of a lane. */
export const cellKey = (columnId: string, lane: string) => `${CELL_PREFIX}${lane}:${columnId}`;
export const isCellKey = (id: string) => id.startsWith(CELL_PREFIX);

/** Lane and column of a cell id (ids never contain ":"). */
export function parseCell(id: string): { lane: string; columnId: string } | null {
  if (!isCellKey(id)) return null;
  const rest = id.slice(CELL_PREFIX.length);
  const i = rest.indexOf(":");
  return i < 0 ? null : { lane: rest.slice(0, i), columnId: rest.slice(i + 1) };
}

export interface Copy {
  card: CardDTO;
  /** The lane the card is moved from. */
  from: string;
}

export interface Cell {
  /** Cards moved from this cell, in column order. */
  cards: CardDTO[];
  /** Read-only copies of cards whose first lane is another one. */
  copies: Copy[];
}

export interface Grouping {
  cells: Map<string, Cell>;
  /** The cell each card is moved from. */
  cellOf: Map<string, string>;
}

/**
 * Splits every column into its lanes. `override` puts one card in another
 * lane than its fields say: the card being dragged, until it is dropped.
 */
export function groupCells(
  columns: ColumnDTO[],
  lanes: Lane[],
  group: GroupBy,
  override?: { cardId: string; lane: string } | null
): Grouping {
  const order = new Map(lanes.map((l, i) => [l.key, i]));
  const cells = new Map<string, Cell>();
  const cellOf = new Map<string, string>();
  for (const column of columns) {
    for (const lane of lanes) cells.set(cellKey(column.id, lane.key), { cards: [], copies: [] });
    for (const card of column.cards) {
      const { primary, copies } = cardLanes(card, group, order);
      const lane = override && override.cardId === card.id && order.has(override.lane) ? override.lane : primary;
      const key = cellKey(column.id, lane);
      cells.get(key)?.cards.push(card);
      cellOf.set(card.id, key);
      for (const copy of copies) {
        if (copy !== lane) cells.get(cellKey(column.id, copy))?.copies.push({ card, from: lane });
      }
    }
  }
  return { cells, cellOf };
}

const sameList = (a: CardDTO[], b: CardDTO[]) => a.length === b.length && a.every((card, i) => card === b[i]);
const sameCopies = (a: Copy[], b: Copy[]) =>
  a.length === b.length && a.every((copy, i) => copy.card === b[i].card && copy.from === b[i].from);

/**
 * `next` with the cells of `prev` that did not change, so memoized cells only
 * re-render when their own cards do (see docs/PERFORMANCE.md).
 */
export function shareCells(prev: Grouping, next: Grouping): Grouping {
  let changed = prev.cells.size !== next.cells.size;
  const cells = new Map<string, Cell>();
  for (const [key, cell] of next.cells) {
    const old = prev.cells.get(key);
    if (old && sameList(old.cards, cell.cards) && sameCopies(old.copies, cell.copies)) {
      cells.set(key, old);
    } else {
      cells.set(key, cell);
      changed = true;
    }
  }
  return changed ? { cells, cellOf: next.cellOf } : { cells: prev.cells, cellOf: next.cellOf };
}

/**
 * Where a card goes in its column (0-based, counted without the card) to be
 * at `index` among the cards of its cell. `columnCards` and `cellCards` both
 * leave the moved card out. A card going into an empty cell keeps its place
 * if it stays in the column (`fallback`), or goes to the end.
 */
export function columnIndexFor(columnCards: CardDTO[], cellCards: CardDTO[], index: number, fallback?: number): number {
  if (cellCards.length === 0) return fallback ?? columnCards.length;
  if (index < cellCards.length) {
    const at = columnCards.indexOf(cellCards[Math.max(0, index)]);
    return at < 0 ? columnCards.length : at;
  }
  const last = columnCards.indexOf(cellCards[cellCards.length - 1]);
  return last < 0 ? columnCards.length : last + 1;
}

// ---------- Changing lanes ----------

export interface LaneChange {
  /** Applied to the card right away (optimistic). */
  patch: CardPatch;
  /** Sent to the server, or queued offline. */
  ops: OutboxOp[];
}

/**
 * What moving a card from lane `from` to lane `to` changes (see the rules at
 * the top). `lanes` gives the person or tag of a lane key.
 */
export function laneChange(card: CardDTO, group: GroupBy, from: string, to: string, lanes: Lane[]): LaneChange {
  const none: LaneChange = { patch: {}, ops: [] };
  if (from === to || group === "none") return none;
  if (group === "priority") {
    if (card.priority === to) return none;
    return { patch: { priority: to }, ops: [{ kind: "update", cardId: card.id, fields: { priority: to } }] };
  }
  const lane = lanes.find((l) => l.key === to);
  if (group === "assignee") {
    const target = lane?.kind === "assignee" ? lane.member : null;
    if (to !== NO_LANE && !target) return none;
    const remove = card.assignees.filter((u) => (to === NO_LANE ? true : u.id === from));
    const add = target && !card.assignees.some((u) => u.id === target.id) ? target : null;
    const ops: OutboxOp[] = [
      ...remove.map((user): OutboxOp => ({ kind: "assignee", cardId: card.id, user, on: false })),
      ...(add ? [{ kind: "assignee", cardId: card.id, user: add, on: true } as OutboxOp] : []),
    ];
    if (ops.length === 0) return none;
    const kept = card.assignees.filter((u) => !remove.includes(u));
    return { patch: { assignees: add ? [...kept, add] : kept }, ops };
  }
  const target = lane?.kind === "tag" ? lane.tag : null;
  if (to !== NO_LANE && !target) return none;
  const remove = card.tags.filter((tg) => (to === NO_LANE ? true : tg.id === from));
  const add = target && !card.tags.some((tg) => tg.id === target.id) ? target : null;
  const ops: OutboxOp[] = [
    ...remove.map((tag): OutboxOp => ({ kind: "tag", cardId: card.id, tag, on: false })),
    ...(add ? [{ kind: "tag", cardId: card.id, tag: add, on: true } as OutboxOp] : []),
  ];
  if (ops.length === 0) return none;
  const kept = card.tags.filter((tg) => !remove.includes(tg));
  return { patch: { tags: add ? [...kept, add] : kept }, ops };
}

/** The lane a new card starts in, before laneChange puts it in its cell's lane. */
export function blankLane(group: GroupBy): string {
  return group === "priority" ? "normal" : NO_LANE;
}
