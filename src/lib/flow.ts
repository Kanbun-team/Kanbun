// Flow metrics for a board (board insights and the card age marker), computed
// from the card history (CardActivity "created" and "moved" entries). Pure
// functions without Prisma, so they run in tests and on the server alike.
//
// Definitions, in board order (first column ... last column):
// - "Done" is the last column, as in My work.
// - Work columns are the columns between the first and the last one. On a
//   board with two columns the first one is the work column.
// - A card's cycle time runs from when it first entered a work column (its
//   creation, when it was created in one) until it last entered Done. Cards
//   that never were in a work column (created in Done, or moved straight from
//   the first column to Done) count as finished but have no cycle time.
// - Days and weeks are UTC; weeks start on Monday.

import { t, tn, type Locale } from "@/lib/i18n";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** Weeks of throughput and of finished cards for the cycle time. */
export const WEEKS = 12;
/** How far back stays count toward the usual time in a column. */
export const USUAL_WINDOW_DAYS = 90;
/** Fewer finished stays than this and a column has no usual time. */
export const USUAL_MIN_SAMPLES = 5;
/** A card is never "longer than usual" before this long in a column. */
export const USUAL_MIN_MS = 3 * DAY;
/** Stays shorter than this (a quick correction) are not counted. */
const MIN_STAY_MS = 60 * 1000;
/** Upper bounds (in days) of the cycle time distribution buckets; the last bucket is open. */
export const CYCLE_BUCKETS_DAYS = [1, 2, 5, 10, 20] as const;

export const FLOW_ACTIVITY_TYPES = ["created", "createdFromTemplate", "createdBySchedule", "moved"] as const;

export type FlowColumn = { id: string; name: string };
export type FlowCard = { id: string; columnId: string; createdAt: number };

type ColumnRef = { id: string | null; name: string | null };
export type FlowEvent = {
  cardId: string;
  at: number;
  created: boolean;
  from: ColumnRef | null;
  to: ColumnRef;
};

export type Stay = { columnId: string | null; start: number; end: number | null };
export type Timeline = {
  cardId: string;
  stays: Stay[];
  /** The history starts with the card's creation. */
  complete: boolean;
  /** At least one history entry exists, so the current stay's start is known. */
  known: boolean;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A CardActivity row as a flow event, or null for other types or broken data. */
export function toFlowEvent(row: { cardId: string; type: string; data: string; createdAt: Date | number }): FlowEvent | null {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const at = typeof row.createdAt === "number" ? row.createdAt : row.createdAt.getTime();
  if (row.type === "moved") {
    return {
      cardId: row.cardId,
      at,
      created: false,
      from: { id: str(data.fromId), name: str(data.from) },
      to: { id: str(data.toId), name: str(data.to) },
    };
  }
  if ((FLOW_ACTIVITY_TYPES as readonly string[]).includes(row.type)) {
    return { cardId: row.cardId, at, created: true, from: null, to: { id: str(data.columnId), name: str(data.column) } };
  }
  return null;
}

/**
 * Finds a column by id (entries written since column ids were recorded),
 * else by name (older entries; the first column with that name). Columns that
 * were deleted, or renamed before ids were recorded, resolve to null.
 */
export function columnResolver(columns: FlowColumn[]) {
  const ids = new Set(columns.map((c) => c.id));
  const byName = new Map<string, string>();
  for (const c of columns) if (!byName.has(c.name)) byName.set(c.name, c.id);
  return (ref: ColumnRef | null): string | null => {
    if (!ref) return null;
    if (ref.id && ids.has(ref.id)) return ref.id;
    return ref.name ? (byName.get(ref.name) ?? null) : null;
  };
}

/** The columns a card has been in, oldest first. `events` are this card's, in any order. */
export function buildTimeline(card: FlowCard, events: FlowEvent[], resolve: (ref: ColumnRef | null) => string | null): Timeline {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const stays: Stay[] = [];
  let complete = false;
  let rest = sorted;
  if (sorted.length === 0) {
    stays.push({ columnId: card.columnId, start: card.createdAt, end: null });
  } else if (sorted[0].created) {
    complete = true;
    stays.push({ columnId: resolve(sorted[0].to), start: sorted[0].at, end: null });
    rest = sorted.slice(1);
  } else {
    // History begins with a move: the card was in that move's column before.
    stays.push({ columnId: resolve(sorted[0].from), start: Math.min(card.createdAt, sorted[0].at), end: null });
  }
  for (const e of rest) {
    stays[stays.length - 1].end = e.at;
    stays.push({ columnId: resolve(e.to), start: e.at, end: null });
  }
  // The card is where it is now, whatever the last entry says (a renamed
  // column, an entry written before ids were recorded).
  stays[stays.length - 1].columnId = card.columnId;
  return { cardId: card.id, stays, complete, known: sorted.length > 0 };
}

export function buildTimelines(columns: FlowColumn[], cards: FlowCard[], events: FlowEvent[]): Timeline[] {
  const resolve = columnResolver(columns);
  const byCard = new Map<string, FlowEvent[]>();
  for (const e of events) {
    const list = byCard.get(e.cardId);
    if (list) list.push(e);
    else byCard.set(e.cardId, [e]);
  }
  return cards.map((card) => buildTimeline(card, byCard.get(card.id) ?? [], resolve));
}

/** The p-quantile (0..1) of ascending `sorted`, linearly interpolated; null when empty. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function utcDay(t: number): number {
  return Math.floor(t / DAY) * DAY;
}

/** Monday 00:00 UTC of the week that contains `t`. */
export function weekStart(t: number): number {
  const day = utcDay(t);
  const monday = (new Date(day).getUTCDay() + 6) % 7;
  return day - monday * DAY;
}

/** The work columns (see the top of this file). */
export function workColumnIds(columns: FlowColumn[]): Set<string> {
  if (columns.length < 2) return new Set();
  if (columns.length === 2) return new Set([columns[0].id]);
  return new Set(columns.slice(1, -1).map((c) => c.id));
}

export type ColumnUsual = { columnId: string; samples: number; p85: number | null; threshold: number | null };

/**
 * How long cards usually stay in each work column: the 85th percentile of
 * the stays that ended in the last USUAL_WINDOW_DAYS. A column needs
 * USUAL_MIN_SAMPLES of them, and the threshold for "longer than usual" is at
 * least USUAL_MIN_MS.
 */
export function usualTimes(columns: FlowColumn[], timelines: Timeline[], now: number): Map<string, ColumnUsual> {
  const work = workColumnIds(columns);
  const since = now - USUAL_WINDOW_DAYS * DAY;
  const samples = new Map<string, number[]>([...work].map((id) => [id, []]));
  for (const tl of timelines) {
    for (const s of tl.stays) {
      if (s.end === null || s.end < since || !s.columnId) continue;
      const list = samples.get(s.columnId);
      if (list && s.end - s.start >= MIN_STAY_MS) list.push(s.end - s.start);
    }
  }
  const out = new Map<string, ColumnUsual>();
  for (const [columnId, list] of samples) {
    list.sort((a, b) => a - b);
    const p85 = list.length >= USUAL_MIN_SAMPLES ? percentile(list, 0.85) : null;
    out.set(columnId, {
      columnId,
      samples: list.length,
      p85,
      threshold: p85 === null ? null : Math.max(p85, USUAL_MIN_MS),
    });
  }
  return out;
}

/** Whole days since `enteredAt` when that is longer than the column's usual time, else null. */
export function staleDays(enteredAt: number | null, usual: ColumnUsual | undefined, now: number): number | null {
  if (enteredAt === null || !usual || usual.threshold === null) return null;
  const age = now - enteredAt;
  return age > usual.threshold ? Math.floor(age / DAY) : null;
}

export type Insights = {
  columns: FlowColumn[];
  doneColumnId: string | null;
  workColumnIds: string[];
  /** The oldest history entry of the board's cards. */
  historyStart: number | null;
  /** Cards whose history does not start with their creation (older or imported cards). */
  partialCards: number;
  totalCards: number;
  cycle: {
    /** Cycle times of the cards finished in the last WEEKS weeks, ascending. */
    samples: { cardId: string; ms: number }[];
    median: number | null;
    p85: number | null;
    /** Finished cards in the window without a cycle time (never in a work column). */
    skipped: number;
    /** Card counts per CYCLE_BUCKETS_DAYS bucket (one more than the bounds). */
    buckets: number[];
  };
  throughput: { weekStart: number; count: number }[];
  flow: { day: number; counts: number[] }[];
  aging: { cardId: string; columnId: string; ms: number; over: boolean; known: boolean }[];
  usual: Map<string, ColumnUsual>;
};

export function computeInsights(input: {
  columns: FlowColumn[];
  cards: FlowCard[];
  events: FlowEvent[];
  now: number;
  flowDays: number;
}): Insights {
  const { columns, cards, events, now, flowDays } = input;
  const timelines = buildTimelines(columns, cards, events);
  const done = columns.length >= 2 ? columns[columns.length - 1].id : null;
  const work = workColumnIds(columns);
  const usual = usualTimes(columns, timelines, now);

  // Cycle time and throughput: cards in Done, finished when they last got there.
  const firstWeek = weekStart(now) - (WEEKS - 1) * 7 * DAY;
  const throughput = Array.from({ length: WEEKS }, (_, i) => ({ weekStart: firstWeek + i * 7 * DAY, count: 0 }));
  const samples: { cardId: string; ms: number }[] = [];
  let skipped = 0;
  if (done) {
    for (const tl of timelines) {
      const last = tl.stays[tl.stays.length - 1];
      if (last.columnId !== done || last.start < firstWeek || last.start > now) continue;
      throughput[Math.floor((last.start - firstWeek) / (7 * DAY))].count++;
      const start = tl.stays.find((s) => s.columnId !== null && work.has(s.columnId) && s.start <= last.start);
      if (start) samples.push({ cardId: tl.cardId, ms: last.start - start.start });
      else skipped++;
    }
  }
  samples.sort((a, b) => a.ms - b.ms);
  const sortedMs = samples.map((s) => s.ms);
  const buckets = new Array<number>(CYCLE_BUCKETS_DAYS.length + 1).fill(0);
  for (const ms of sortedMs) {
    const i = CYCLE_BUCKETS_DAYS.findIndex((bound) => ms < bound * DAY);
    buckets[i < 0 ? CYCLE_BUCKETS_DAYS.length : i]++;
  }

  // Cumulative flow: where each card was at the end of each day (today: now).
  const index = new Map(columns.map((c, i) => [c.id, i]));
  const firstDay = utcDay(now) - (flowDays - 1) * DAY;
  const sampleAt = (i: number) => Math.min(firstDay + (i + 1) * DAY - 1, now);
  const flow = Array.from({ length: flowDays }, (_, i) => ({ day: firstDay + i * DAY, counts: new Array<number>(columns.length).fill(0) }));
  for (const tl of timelines) {
    for (const s of tl.stays) {
      const col = s.columnId === null ? undefined : index.get(s.columnId);
      if (col === undefined) continue;
      const end = s.end ?? Infinity;
      // First day whose sample time is at or after the start.
      let i = Math.max(0, Math.ceil((s.start - firstDay + 1) / DAY) - 1);
      for (; i < flowDays; i++) {
        const at = sampleAt(i);
        if (at >= end) break;
        if (at >= s.start) flow[i].counts[col]++;
      }
    }
  }

  // Aging work in progress: open cards in work columns, oldest first.
  const aging: Insights["aging"] = [];
  for (const tl of timelines) {
    const last = tl.stays[tl.stays.length - 1];
    if (!last.columnId || !work.has(last.columnId)) continue;
    const ms = Math.max(0, now - last.start);
    const threshold = usual.get(last.columnId)?.threshold ?? null;
    aging.push({ cardId: tl.cardId, columnId: last.columnId, ms, known: tl.known, over: tl.known && threshold !== null && ms > threshold });
  }
  aging.sort((a, b) => b.ms - a.ms);

  let historyStart: number | null = null;
  for (const e of events) if (historyStart === null || e.at < historyStart) historyStart = e.at;

  return {
    columns,
    doneColumnId: done,
    workColumnIds: columns.filter((c) => work.has(c.id)).map((c) => c.id),
    historyStart,
    partialCards: timelines.filter((tl) => !tl.complete).length,
    totalCards: cards.length,
    cycle: {
      samples,
      median: percentile(sortedMs, 0.5),
      p85: percentile(sortedMs, 0.85),
      skipped,
      buckets,
    },
    throughput,
    flow,
    aging,
    usual,
  };
}

/** A duration in words: "Under 1 hour", "5 hours", "3 days". */
export function formatDuration(ms: number, locale: Locale): string {
  if (ms < HOUR) return t("insightsUnderHour", locale);
  if (ms < DAY - HOUR / 2) return tn("insightsHours", Math.max(1, Math.round(ms / HOUR)), locale);
  return tn("insightsDays", Math.max(1, Math.round(ms / DAY)), locale);
}
