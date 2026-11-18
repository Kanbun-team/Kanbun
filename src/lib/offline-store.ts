"use client";

// Client-side offline state for the signed-in user: the outbox of queued card
// edits and the latest board snapshots, kept in memory for rendering
// (useSyncExternalStore) and persisted to IndexedDB, plus card details for
// offline reading (IndexedDB only, read on demand). Everything is keyed by
// user id, and data of any other user found on the device is deleted, so a
// second person signing in on the same browser never sees it.

import { useSyncExternalStore } from "react";
import { idbClear, idbDelete, idbGet, idbKeys, idbSet } from "./idb";
import { cardIdsOf, enqueue, newId, replay, type IdMap, type OutboxEntry, type OutboxOp, type RunResult } from "./outbox";
import { newerCard, type OfflineBoardCards, type StoredCard } from "./offline-card";
import { isOnline } from "./use-online";
import type { ColumnDTO } from "@/components/board/types";

export interface BoardSnapshot {
  columns: ColumnDTO[];
  /** When the server rendered this data (ISO). */
  renderedAt: string;
}

export interface OfflineState {
  userId: string | null;
  /** The outbox has been read from IndexedDB. */
  loaded: boolean;
  /** Waiting to be sent, in order. */
  entries: OutboxEntry[];
  /** Sent, but still applied on top of the board until fresh data arrives. */
  applied: OutboxEntry[];
  idMap: IdMap;
  syncing: boolean;
  /** undefined: not read yet, null: none stored. */
  snapshots: Record<string, BoardSnapshot | null | undefined>;
}

interface StoredOutbox {
  entries: OutboxEntry[];
  idMap: IdMap;
}

const EMPTY: OfflineState = {
  userId: null,
  loaded: false,
  entries: [],
  applied: [],
  idMap: {},
  syncing: false,
  snapshots: {},
};

let state: OfflineState = EMPTY;
let inflightId: string | null = null;
/** Entry ids this tab has written to IndexedDB. */
const persisted = new Set<string>();
const listeners = new Set<() => void>();

const outboxKey = (userId: string) => `outbox:${userId}`;
const snapshotKey = (userId: string, boardId: string) => `snap:${userId}:${boardId}`;
/** Details of a card the user opened. */
const cardKey = (userId: string, cardId: string) => `card:${userId}:${cardId}`;
/** Lightweight details of every card of a board (GET /api/boards/[id]/offline). */
const boardCardsKey = (userId: string, boardId: string) => `bcards:${userId}:${boardId}`;
/** Ids of the stored opened cards, most recent first. */
const cardIndexKey = (userId: string) => `cardidx:${userId}`;

/** Opened cards kept per user; older ones are deleted. */
const MAX_STORED_CARDS = 200;
/** A board's card details are fetched again at most this often. */
const PREFETCH_EVERY_MS = 10 * 60_000;

/** Keys of this user's data (everything else is deleted when they sign in). */
function ownKey(userId: string, key: string): boolean {
  return (
    key === outboxKey(userId) ||
    key === cardIndexKey(userId) ||
    [`snap:${userId}:`, `card:${userId}:`, `bcards:${userId}:`].some((prefix) => key.startsWith(prefix))
  );
}

function set(next: Partial<OfflineState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function persistOutbox() {
  const userId = state.userId;
  if (!userId) return Promise.resolve();
  const value: StoredOutbox = { entries: state.entries, idMap: state.idMap };
  for (const e of state.entries) persisted.add(e.id);
  return idbSet(outboxKey(userId), value);
}

async function readOutbox(userId: string): Promise<StoredOutbox> {
  const stored = await idbGet<StoredOutbox>(outboxKey(userId));
  return {
    entries: Array.isArray(stored?.entries) ? stored.entries : [],
    idMap: stored?.idMap && typeof stored.idMap === "object" ? stored.idMap : {},
  };
}

/** Switches the store to this user, loading their outbox and deleting other users' data. */
export function ensureUser(userId: string) {
  if (state.userId === userId) return;
  state = { ...EMPTY, userId };
  persisted.clear();
  prefetched.clear();
  for (const l of listeners) l();
  void (async () => {
    const stored = await readOutbox(userId);
    if (state.userId !== userId) return;
    for (const e of stored.entries) persisted.add(e.id);
    const known = new Set(stored.entries.map((e) => e.id));
    set({
      loaded: true,
      // Edits made before the read finished go after the stored ones.
      entries: [...stored.entries, ...state.entries.filter((e) => !known.has(e.id))],
      idMap: { ...stored.idMap, ...state.idMap },
    });
    if (state.entries.length !== stored.entries.length) void persistOutbox();
    const keys = await idbKeys();
    await Promise.all(keys.filter((k) => !ownKey(userId, k)).map((k) => idbDelete(k)));
  })();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOfflineState(): OfflineState {
  return state;
}

/** The offline state for this user (the empty state during server render and hydration). */
export function useOfflineState(userId: string): OfflineState {
  return useSyncExternalStore(
    (notify) => {
      ensureUser(userId);
      return subscribe(notify);
    },
    () => (state.userId === userId ? state : EMPTY),
    () => EMPTY
  );
}

export function pendingFor(s: OfflineState, boardId: string): number {
  return s.entries.filter((e) => e.boardId === boardId).length;
}

// ---------- Board snapshots ----------

export function loadSnapshot(boardId: string) {
  const userId = state.userId;
  if (!userId || state.snapshots[boardId] !== undefined) return;
  set({ snapshots: { ...state.snapshots, [boardId]: null } });
  void idbGet<BoardSnapshot>(snapshotKey(userId, boardId)).then((snap) => {
    if (state.userId !== userId || !snap || !Array.isArray(snap.columns)) return;
    const current = state.snapshots[boardId];
    if (current && current.renderedAt >= snap.renderedAt) return;
    set({ snapshots: { ...state.snapshots, [boardId]: snap } });
  });
}

/** Stores server data for offline use, unless a newer snapshot is already kept. */
export function saveSnapshot(boardId: string, snapshot: BoardSnapshot) {
  const userId = state.userId;
  if (!userId) return;
  const current = state.snapshots[boardId];
  if (current && current.renderedAt >= snapshot.renderedAt) return;
  set({ snapshots: { ...state.snapshots, [boardId]: snapshot } });
  void idbSet(snapshotKey(userId, boardId), snapshot);
}

// ---------- Card details ----------

/** Boards whose card details were fetched by this tab, with the time. */
const prefetched = new Map<string, number>();
let cardIndexChain: Promise<unknown> = Promise.resolve();

function isStoredCard(value: unknown): value is StoredCard {
  const v = value as StoredCard | undefined;
  return !!v && typeof v.renderedAt === "string" && !!v.card && typeof v.card.id === "string" && Array.isArray(v.members);
}

function isBoardCards(value: unknown): value is OfflineBoardCards {
  const v = value as OfflineBoardCards | undefined;
  return !!v && typeof v.renderedAt === "string" && Array.isArray(v.cards) && Array.isArray(v.members) && Array.isArray(v.tags);
}

/** Stores the details of a card the user opened, unless a newer copy is kept. */
export function saveCard(record: StoredCard): Promise<void> {
  const userId = state.userId;
  if (!userId) return Promise.resolve();
  const cardId = record.card.id;
  const task = cardIndexChain.then(async () => {
    const current = await idbGet<StoredCard>(cardKey(userId, cardId));
    if (state.userId !== userId) return;
    if (isStoredCard(current) && current.renderedAt > record.renderedAt) return;
    await idbSet(cardKey(userId, cardId), record);
    const stored = await idbGet<string[]>(cardIndexKey(userId));
    const index = [cardId, ...(Array.isArray(stored) ? stored.filter((id) => id !== cardId) : [])];
    if (state.userId !== userId) return;
    await idbSet(cardIndexKey(userId), index.slice(0, MAX_STORED_CARDS));
    await Promise.all(index.slice(MAX_STORED_CARDS).map((id) => idbDelete(cardKey(userId, id))));
  });
  cardIndexChain = task.catch(() => undefined);
  return task;
}

/** The newest stored details of a card: from opening it, or from its board's lightweight copy. */
export async function readCard(boardId: string, cardId: string): Promise<StoredCard | undefined> {
  const userId = state.userId;
  if (!userId) return undefined;
  const [full, board] = await Promise.all([
    idbGet<StoredCard>(cardKey(userId, cardId)),
    idbGet<OfflineBoardCards>(boardCardsKey(userId, boardId)),
  ]);
  if (state.userId !== userId) return undefined;
  const fromOpen = isStoredCard(full) && full.card.boardId === boardId ? full : undefined;
  const liteCard = isBoardCards(board) ? board.cards.find((c) => c?.id === cardId) : undefined;
  const fromBoard: StoredCard | undefined =
    liteCard && isBoardCards(board)
      ? { card: liteCard, members: board.members, tags: board.tags, renderedAt: board.renderedAt, partial: true }
      : undefined;
  return newerCard(fromOpen, fromBoard);
}

/**
 * Fetches lightweight details of every card of a board in the background, so
 * cards never opened can still be read offline. At most every 10 minutes per
 * board; failures are ignored (the board works as before).
 */
export function prefetchBoardCards(boardId: string): void {
  const userId = state.userId;
  if (!userId || !isOnline() || typeof fetch === "undefined") return;
  const last = prefetched.get(boardId);
  if (last !== undefined && Date.now() - last < PREFETCH_EVERY_MS) return;
  prefetched.set(boardId, Date.now());
  void (async () => {
    try {
      const stored = await idbGet<OfflineBoardCards>(boardCardsKey(userId, boardId));
      if (isBoardCards(stored) && Date.now() - Date.parse(stored.renderedAt) < PREFETCH_EVERY_MS) return;
      const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/offline`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok || res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) return;
      const data: unknown = await res.json();
      // Signed out or switched user while fetching: drop it.
      if (state.userId !== userId || !isBoardCards(data) || data.boardId !== boardId) return;
      await idbSet(boardCardsKey(userId, boardId), data);
    } catch {
      // Offline or the server is unreachable: try again next time.
      prefetched.delete(boardId);
    }
  })();
}

// ---------- Outbox ----------

/** Window event asking the app to replay the outbox now (see PwaClient). */
export const SYNC_EVENT = "kanbun:sync";

export function requestSync() {
  window.dispatchEvent(new Event(SYNC_EVENT));
}

export function addEntry(entry: OutboxEntry) {
  if (!state.userId) return;
  set({ entries: enqueue(state.entries, entry, inflightId) });
  void persistOutbox();
}

/** Queues a card edit for this board; sends it right away when online. */
export function queueEdit(boardId: string, op: OutboxOp, label: string) {
  addEntry({ id: newId(), boardId, createdAt: Date.now(), label, op });
  if (isOnline()) requestSync();
}

/** Fresh server data arrived: synced entries no longer need to be applied on top. */
export function clearApplied() {
  if (state.syncing || state.applied.length === 0) return;
  const stillUsed = new Set(
    state.entries.flatMap((e) => cardIdsOf(e.op))
  );
  const idMap = Object.fromEntries(Object.entries(state.idMap).filter(([temp]) => stillUsed.has(temp)));
  set({ applied: [], idMap });
  void persistOutbox();
}

export interface FlushResult {
  synced: OutboxEntry[];
  failed: { entry: OutboxEntry; error: string }[];
  /** Stopped by a network (or retryable) error; entries are left to retry. */
  interrupted: boolean;
}

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request(name, fn) as Promise<T>;
}

/**
 * Sends queued entries in order until the outbox is empty or the network
 * fails. Only one tab flushes at a time (Web Locks), and it re-reads the
 * outbox first so an entry another tab already sent is not sent twice.
 */
export async function flushOutbox(
  run: (op: OutboxOp) => Promise<RunResult>,
  retryable: (error: string) => boolean
): Promise<FlushResult> {
  const userId = state.userId;
  const total: FlushResult = { synced: [], failed: [], interrupted: false };
  if (!userId || state.syncing || !state.loaded || state.entries.length === 0) return total;
  set({ syncing: true });
  try {
    await withLock(`kanbun-outbox:${userId}`, async () => {
      const stored = await readOutbox(userId);
      if (state.userId !== userId) return;
      const storedIds = new Set(stored.entries.map((e) => e.id));
      // Entries this tab persisted that are gone were sent by another tab.
      const local = state.entries.filter((e) => !storedIds.has(e.id) && !persisted.has(e.id));
      set({ entries: [...stored.entries, ...local], idMap: { ...stored.idMap, ...state.idMap } });

      for (;;) {
        const batch = state.entries;
        if (batch.length === 0 || state.userId !== userId) break;
        const outcome = await replay(batch, state.idMap, run, {
          retryable,
          onStart: (entry) => {
            inflightId = entry.id;
          },
          onSettled: async (entry, idMap, ok) => {
            inflightId = null;
            if (state.userId !== userId) return;
            set({
              entries: state.entries.filter((e) => e.id !== entry.id),
              applied: ok ? [...state.applied, entry] : state.applied,
              idMap,
            });
            await persistOutbox();
          },
        });
        inflightId = null;
        total.synced.push(...outcome.synced);
        total.failed.push(...outcome.failed);
        if (outcome.interrupted) {
          total.interrupted = true;
          break;
        }
      }
    });
  } finally {
    inflightId = null;
    set({ syncing: false });
  }
  return total;
}

/**
 * Deletes all offline data of this browser (logout): IndexedDB, the cached
 * pages of the service worker, and the worker's idea of who is signed in.
 * The static asset cache holds no user data and is kept.
 */
export async function clearOfflineData() {
  state = { ...EMPTY };
  persisted.clear();
  prefetched.clear();
  for (const l of listeners) l();
  const tasks: Promise<unknown>[] = [idbClear()];
  if (typeof caches !== "undefined") {
    tasks.push(
      caches
        .keys()
        .then((names) =>
          Promise.all(names.filter((n) => n.startsWith("kanbun-pages-") || n === "kanbun-meta").map((n) => caches.delete(n)))
        )
        .catch(() => undefined)
    );
  }
  navigator.serviceWorker?.controller?.postMessage({ type: "logout" });
  // Never let a broken storage layer block signing out.
  await Promise.race([Promise.all(tasks), new Promise((resolve) => setTimeout(resolve, 2000))]);
}
