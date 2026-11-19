// Loads card history for the flow metrics in src/lib/flow.ts: the board
// insights page and the "longer than usual" marker on the board's cards.
// Callers check board access first.

import { prisma } from "@/lib/db-local";
import {
  FLOW_ACTIVITY_TYPES,
  buildTimelines,
  computeInsights,
  staleDays,
  toFlowEvent,
  usualTimes,
  type ColumnUsual,
  type FlowEvent,
} from "@/lib/flow";

async function loadHistory(boardId: string) {
  const columns = await prisma.boardColumn.findMany({
    where: { boardId },
    orderBy: { position: "asc" },
    select: { id: true, name: true },
  });
  const cards = await prisma.taskCard.findMany({
    where: { column: { boardId } },
    select: { id: true, title: true, columnId: true, createdAt: true },
  });
  // By card id, which CardActivity is indexed by.
  const rows = cards.length
    ? await prisma.cardActivity.findMany({
        where: { cardId: { in: cards.map((c) => c.id) }, type: { in: [...FLOW_ACTIVITY_TYPES] } },
        select: { cardId: true, type: true, data: true, createdAt: true },
      })
    : [];
  const events = rows.map(toFlowEvent).filter((e): e is FlowEvent => e !== null);
  return {
    columns,
    cards: cards.map((c) => ({ id: c.id, title: c.title, columnId: c.columnId, createdAt: c.createdAt.getTime() })),
    events,
  };
}

export async function boardInsights(boardId: string, flowDays: number, now = Date.now()) {
  const { columns, cards, events } = await loadHistory(boardId);
  const insights = computeInsights({ columns, cards, events, now, flowDays });
  usualCache.set(boardId, { at: now, usual: insights.usual });
  return { insights, titles: new Map(cards.map((c) => [c.id, c.title])) };
}

// The usual time per column moves slowly, so the board keeps it for a few
// minutes instead of reading the whole history on every load.
const USUAL_TTL_MS = 10 * 60 * 1000;
const usualCache = new Map<string, { at: number; usual: Map<string, ColumnUsual> }>();

async function usualFor(boardId: string, now: number): Promise<Map<string, ColumnUsual>> {
  const hit = usualCache.get(boardId);
  if (hit && now - hit.at < USUAL_TTL_MS) return hit.usual;
  const { columns, cards, events } = await loadHistory(boardId);
  const usual = usualTimes(columns, buildTimelines(columns, cards, events), now);
  if (usualCache.size > 500) usualCache.clear();
  usualCache.set(boardId, { at: now, usual });
  return usual;
}

/**
 * Whole days in the current column for the cards that have been there longer
 * than usual for that column (see `usualTimes`). Cards without history are
 * never marked: when they entered their column is unknown.
 */
export async function staleCardDays(
  boardId: string,
  cards: { id: string; columnId: string }[],
  now = Date.now()
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (cards.length === 0) return out;
  const usual = await usualFor(boardId, now);
  const watched = cards.filter((c) => usual.get(c.columnId)?.threshold != null);
  if (watched.length === 0) return out;
  // The newest "created" or "moved" entry of a card is when it entered the
  // column it is in now (moves within a column are not recorded).
  const entered = await prisma.cardActivity.groupBy({
    by: ["cardId"],
    where: { cardId: { in: watched.map((c) => c.id) }, type: { in: [...FLOW_ACTIVITY_TYPES] } },
    _max: { createdAt: true },
  });
  const at = new Map(entered.map((r) => [r.cardId, r._max.createdAt?.getTime() ?? null]));
  for (const c of watched) {
    const days = staleDays(at.get(c.id) ?? null, usual.get(c.columnId), now);
    if (days !== null) out.set(c.id, days);
  }
  return out;
}
