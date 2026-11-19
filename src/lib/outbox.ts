// Offline outbox: card edits made while the board can not reach the server.
//
// Pure logic only (no IndexedDB, no React, no server actions), so it can be
// unit tested. Persistence lives in src/lib/offline-store.ts and the code that
// sends an operation to the server in src/components/board/offline-runner.ts.
//
// Rules:
// - Entries replay in the order they were made, through the same server
//   actions the online path uses. Last write wins.
// - Repeated edits of the same field on the same card collapse into one entry;
//   assignee and tag operations carry the desired state (on/off), so only the
//   latest one per card and person/tag is kept. Checklist toggles carry the
//   desired state too (done or not), so only the latest per item is kept.
// - Comments written offline are never merged: each one is sent once, in
//   order. They get a temporary id (COMMENT_PREFIX) so the card view can show
//   them as pending until they are sent. The server also uses it as the
//   comment's idempotency key, so a replay repeated after a dropped
//   connection does not post the comment twice.
// - Checklist toggles and comments carry the card's resulting counts (done
//   items, comments), so the board card's badges update right away. They are
//   absolute numbers, not +1/-1, so applying an entry the board data already
//   reflects changes nothing (see applyOutbox).
// - Cards created offline get a temporary id (TEMP_PREFIX). Replaying the
//   creation maps it to the real id, and later entries use the real id.
// - An entry the server rejects (card deleted, no access) is dropped and
//   reported. A network error stops the replay and keeps the rest for later.

import type { CardDTO, ColumnDTO, MemberOption, TagOption } from "@/components/board/types";

export const TEMP_PREFIX = "tmp_";
/** Temporary id of a comment written offline. */
export const COMMENT_PREFIX = "tmpc_";

export interface CardFields {
  title?: string;
  priority?: string;
  /** ISO timestamp, or null to clear. */
  deadline?: string | null;
  /** #rrggbb, or null to clear. */
  coverColor?: string | null;
}

export type OutboxOp =
  | { kind: "move"; cardId: string; toColumnId: string; position: number }
  | { kind: "update"; cardId: string; fields: CardFields }
  | { kind: "assignee"; cardId: string; user: MemberOption; on: boolean }
  | { kind: "tag"; cardId: string; tag: TagOption; on: boolean }
  | { kind: "addCards"; columnId: string; titles: string[]; tempIds: string[] }
  | {
      kind: "subtask";
      cardId: string;
      subtaskId: string;
      done: boolean;
      /** Done items of the card after this toggle, for the board card's "2/5" badge. */
      subtasksDone?: number;
    }
  | {
      kind: "comment";
      cardId: string;
      /** Also the comment's idempotency key on the server. */
      tempId: string;
      body: string;
      /** Comments on the card once this one is posted, for the board card's count. */
      commentsCount?: number;
    };

export interface OutboxEntry {
  id: string;
  boardId: string;
  createdAt: number;
  /** Shown when the entry can not be synced (usually the card title). */
  label: string;
  op: OutboxOp;
}

/** Temporary card id to the id the server gave it. */
export type IdMap = Record<string, string>;

export type RunResult = { ok: true; createdIds?: string[] } | { ok: false; error: string };

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

export function newId(prefix = ""): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}${random}`;
}

/** Titles exactly as addCardAction splits them: one card per non-empty line. */
export function splitTitles(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Card ids an operation refers to (before id mapping). */
export function cardIdsOf(op: OutboxOp): string[] {
  return op.kind === "addCards" ? op.tempIds : [op.cardId];
}

export function referencesTempId(op: OutboxOp): boolean {
  return op.kind !== "addCards" && isTempId(op.cardId);
}

/**
 * Adds an entry, collapsing it into earlier ones where that can not change
 * the outcome. `lockedId` is an entry being sent right now: it is never
 * modified or removed, so a change made during a sync is not lost.
 */
export function enqueue(entries: OutboxEntry[], entry: OutboxEntry, lockedId?: string | null): OutboxEntry[] {
  const op = entry.op;
  if (op.kind === "update") {
    for (let i = entries.length - 1; i >= 0; i--) {
      const prev = entries[i];
      if (prev.id === lockedId || prev.op.kind !== "update" || prev.op.cardId !== op.cardId) continue;
      const merged: OutboxEntry = {
        ...prev,
        label: entry.label,
        op: { ...prev.op, fields: { ...prev.op.fields, ...op.fields } },
      };
      return entries.map((e, j) => (j === i ? merged : e));
    }
    return [...entries, entry];
  }
  if (op.kind === "assignee" || op.kind === "tag" || op.kind === "subtask") {
    const kept = entries.filter((prev) => {
      if (prev.id === lockedId || prev.op.kind !== op.kind || prev.op.cardId !== op.cardId) return true;
      if (op.kind === "assignee" && prev.op.kind === "assignee") return prev.op.user.id !== op.user.id;
      if (op.kind === "tag" && prev.op.kind === "tag") return prev.op.tag.id !== op.tag.id;
      if (op.kind === "subtask" && prev.op.kind === "subtask") return prev.op.subtaskId !== op.subtaskId;
      return true;
    });
    return [...kept, entry];
  }
  if (op.kind === "move") {
    const last = entries[entries.length - 1];
    if (last && last.id !== lockedId && last.op.kind === "move" && last.op.cardId === op.cardId) {
      return [...entries.slice(0, -1), { ...entry, id: last.id, createdAt: last.createdAt }];
    }
  }
  return [...entries, entry];
}

/**
 * The operation with temporary ids replaced by real ones. `unresolved` is
 * true when it refers to a card whose creation has not been (or could not
 * be) synced.
 */
export function resolveOp(op: OutboxOp, idMap: IdMap): { op: OutboxOp; unresolved: boolean } {
  if (op.kind === "addCards") return { op, unresolved: false };
  if (!isTempId(op.cardId)) return { op, unresolved: false };
  const real = idMap[op.cardId];
  return real ? { op: { ...op, cardId: real }, unresolved: false } : { op, unresolved: true };
}

export interface ReplayOptions {
  /** Called after each entry is settled (synced, or dropped when ok is false), to persist progress. */
  onSettled?: (entry: OutboxEntry, idMap: IdMap, ok: boolean) => void | Promise<void>;
  /** Called right before an entry is sent. */
  onStart?: (entry: OutboxEntry) => void;
  /** Errors that mean "try again later" instead of "drop it" (e.g. signed out). */
  retryable?: (error: string) => boolean;
}

export interface ReplayOutcome {
  /** Entries not attempted or to retry later, in order. */
  remaining: OutboxEntry[];
  /** Entries the server rejected; they are dropped. */
  failed: { entry: OutboxEntry; error: string }[];
  /** Entries the server accepted. */
  synced: OutboxEntry[];
  idMap: IdMap;
  /** True when a network error (or retryable error) stopped the replay early. */
  interrupted: boolean;
}

export async function replay(
  entries: OutboxEntry[],
  initialIdMap: IdMap,
  run: (op: OutboxOp) => Promise<RunResult>,
  options: ReplayOptions = {}
): Promise<ReplayOutcome> {
  const idMap: IdMap = { ...initialIdMap };
  const failed: ReplayOutcome["failed"] = [];
  const synced: OutboxEntry[] = [];
  const retryable = options.retryable ?? (() => false);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { op, unresolved } = resolveOp(entry.op, idMap);
    if (unresolved) {
      // The card it edits was never created on the server.
      failed.push({ entry, error: "notFound" });
      await options.onSettled?.(entry, idMap, false);
      continue;
    }
    options.onStart?.(entry);
    let result: RunResult;
    try {
      result = await run(op);
    } catch {
      return { remaining: entries.slice(i), failed, synced, idMap, interrupted: true };
    }
    if (!result.ok) {
      if (retryable(result.error)) {
        return { remaining: entries.slice(i), failed, synced, idMap, interrupted: true };
      }
      failed.push({ entry, error: result.error });
      await options.onSettled?.(entry, idMap, false);
      continue;
    } else {
      if (op.kind === "addCards" && result.createdIds) {
        op.tempIds.forEach((tempId, j) => {
          const real = result.createdIds?.[j];
          if (real) idMap[tempId] = real;
        });
      }
      synced.push(entry);
    }
    await options.onSettled?.(entry, idMap, true);
  }
  return { remaining: [], failed, synced, idMap, interrupted: false };
}

export function blankCard(id: string, title: string, position: number): CardDTO {
  return {
    id,
    title,
    priority: "normal",
    coverColor: null,
    deadline: null,
    position,
    assignees: [],
    tags: [],
    subtasksTotal: 0,
    subtasksDone: 0,
    commentsCount: 0,
    blockedByCount: 0,
    attachmentsCount: 0,
  };
}

function mapCard(columns: ColumnDTO[], cardId: string, fn: (card: CardDTO) => CardDTO): ColumnDTO[] {
  let changed = false;
  const next = columns.map((c) => {
    if (!c.cards.some((card) => card.id === cardId)) return c;
    changed = true;
    return { ...c, cards: c.cards.map((card) => (card.id === cardId ? fn(card) : card)) };
  });
  return changed ? next : columns;
}

export function moveCardIn(columns: ColumnDTO[], cardId: string, toColumnId: string, index: number): ColumnDTO[] {
  let moved: CardDTO | undefined;
  const without = columns.map((c) => {
    const i = c.cards.findIndex((card) => card.id === cardId);
    if (i < 0) return c;
    moved = c.cards[i];
    return { ...c, cards: c.cards.filter((card) => card.id !== cardId) };
  });
  if (!moved || !without.some((c) => c.id === toColumnId)) return columns;
  return without.map((c) => {
    if (c.id !== toColumnId) return c;
    const cards = [...c.cards];
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, moved!);
    return { ...c, cards };
  });
}

/**
 * Board data with the given entries applied on top, for display. Applying an
 * entry the data already reflects changes nothing, so entries that were just
 * synced can stay applied until fresh server data arrives.
 */
export function applyOutbox(columns: ColumnDTO[], entries: OutboxEntry[], idMap: IdMap = {}): ColumnDTO[] {
  let result = columns;
  for (const entry of entries) {
    const raw = entry.op;
    if (raw.kind === "addCards") {
      const column = result.find((c) => c.id === raw.columnId);
      if (!column) continue;
      const known = new Set(result.flatMap((c) => c.cards.map((card) => card.id)));
      const fresh: CardDTO[] = [];
      raw.tempIds.forEach((tempId, i) => {
        const id = idMap[tempId] ?? tempId;
        if (known.has(id) || known.has(tempId)) return;
        const last = column.cards[column.cards.length - 1];
        fresh.push(blankCard(id, raw.titles[i] ?? "", (last?.position ?? -1) + 1 + i));
      });
      if (fresh.length) {
        result = result.map((c) => (c.id === column.id ? { ...c, cards: [...c.cards, ...fresh] } : c));
      }
      continue;
    }
    const op = { ...raw, cardId: idMap[raw.cardId] ?? raw.cardId };
    switch (op.kind) {
      case "move":
        result = moveCardIn(result, op.cardId, op.toColumnId, op.position);
        break;
      case "update":
        result = mapCard(result, op.cardId, (card) => ({ ...card, ...op.fields }) as CardDTO);
        break;
      case "assignee":
        result = mapCard(result, op.cardId, (card) => {
          const has = card.assignees.some((a) => a.id === op.user.id);
          if (has === op.on) return card;
          return {
            ...card,
            assignees: op.on ? [...card.assignees, op.user] : card.assignees.filter((a) => a.id !== op.user.id),
          };
        });
        break;
      case "tag":
        result = mapCard(result, op.cardId, (card) => {
          const has = card.tags.some((tg) => tg.id === op.tag.id);
          if (has === op.on) return card;
          return { ...card, tags: op.on ? [...card.tags, op.tag] : card.tags.filter((tg) => tg.id !== op.tag.id) };
        });
        break;
      case "subtask": {
        const done = op.subtasksDone;
        if (done === undefined) break;
        result = mapCard(result, op.cardId, (card) => {
          const next = Math.max(0, Math.min(done, card.subtasksTotal));
          return next === card.subtasksDone ? card : { ...card, subtasksDone: next };
        });
        break;
      }
      case "comment": {
        const count = op.commentsCount;
        if (count === undefined) break;
        result = mapCard(result, op.cardId, (card) =>
          count === card.commentsCount ? card : { ...card, commentsCount: Math.max(0, count) }
        );
        break;
      }
    }
  }
  return result;
}
