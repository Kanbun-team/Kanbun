"use client";

// One EventSource per board per tab, shared by everything that listens: the
// board (refetch on changes), the header avatars and the card panel
// ("also viewing"). Reference counted, so it opens with the first listener and
// closes with the last.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { PresenceViewer } from "@/lib/presence";

type Listener = {
  onBoard?: () => void;
  onPresence?: () => void;
  /** The stream (re)connected. */
  onOpen?: () => void;
  /** The stream went stale or recovered (see useBoardStreamStale). */
  onStatus?: () => void;
};

/** How long the stream may be down before the board says it is offline. */
export const STALE_AFTER_MS = 10_000;

type Stream = {
  source: EventSource;
  connId: string;
  listeners: Set<Listener>;
  viewers: PresenceViewer[];
  /** Card this tab has open, and the last value the server acknowledged. */
  cardId: string | null;
  sentCardId: string | null;
  flushTimer?: ReturnType<typeof setTimeout>;
  closeTimer?: ReturnType<typeof setTimeout>;
  /** Disconnected for longer than STALE_AFTER_MS. */
  stale: boolean;
  staleTimer?: ReturnType<typeof setTimeout>;
};

const EMPTY: PresenceViewer[] = [];
const streams = new Map<string, Stream>();

function newConnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function postCard(boardId: string, stream: Stream) {
  const cardId = stream.cardId;
  stream.sentCardId = cardId;
  void fetch(`/api/boards/${boardId}/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connId: stream.connId, cardId }),
    keepalive: true,
  }).catch(() => {
    // Presence is best effort; the next (re)connect sends it again.
    if (stream.sentCardId === cardId) stream.sentCardId = null;
  });
}

// Coalesces quick switches (closing card A and opening card B) into one POST.
function scheduleFlush(boardId: string, stream: Stream) {
  if (stream.flushTimer) clearTimeout(stream.flushTimer);
  stream.flushTimer = setTimeout(() => {
    stream.flushTimer = undefined;
    if (streams.get(boardId) !== stream) return;
    if (stream.cardId !== stream.sentCardId) postCard(boardId, stream);
  }, 50);
}

function open(boardId: string): Stream {
  const connId = newConnId();
  const source = new EventSource(`/api/boards/${boardId}/events?conn=${encodeURIComponent(connId)}`);
  const stream: Stream = {
    source,
    connId,
    listeners: new Set(),
    viewers: EMPTY,
    cardId: null,
    sentCardId: null,
    stale: false,
  };
  const setStale = (stale: boolean) => {
    if (stream.stale === stale) return;
    stream.stale = stale;
    for (const l of stream.listeners) l.onStatus?.();
  };
  // EventSource retries by itself; a drop that lasts is reported as stale.
  source.addEventListener("error", () => {
    if (stream.staleTimer) return;
    stream.staleTimer = setTimeout(() => {
      stream.staleTimer = undefined;
      if (stream.source.readyState !== EventSource.OPEN) setStale(true);
    }, STALE_AFTER_MS);
  });
  // The server registers the connection before it answers, so by the time the
  // stream is open it is safe to say which card we are on. A reconnect starts
  // a fresh registration with no card, so always re-send.
  source.addEventListener("open", () => {
    stream.sentCardId = null;
    if (stream.cardId) postCard(boardId, stream);
    if (stream.staleTimer) clearTimeout(stream.staleTimer);
    stream.staleTimer = undefined;
    setStale(false);
    for (const l of stream.listeners) l.onOpen?.();
  });
  source.addEventListener("board", () => {
    for (const l of stream.listeners) l.onBoard?.();
  });
  source.addEventListener("presence", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent<string>).data) as { viewers?: PresenceViewer[] };
      stream.viewers = Array.isArray(data.viewers) ? data.viewers : EMPTY;
    } catch {
      return;
    }
    for (const l of stream.listeners) l.onPresence?.();
  });
  streams.set(boardId, stream);
  return stream;
}

export function subscribeBoardStream(boardId: string, listener: Listener): () => void {
  const stream = streams.get(boardId) ?? open(boardId);
  if (stream.closeTimer) clearTimeout(stream.closeTimer);
  stream.closeTimer = undefined;
  stream.listeners.add(listener);
  return () => {
    stream.listeners.delete(listener);
    if (stream.listeners.size > 0) return;
    // Linger briefly so a remount (panel to panel, Strict Mode) reuses it.
    stream.closeTimer = setTimeout(() => {
      if (stream.listeners.size > 0) return;
      if (stream.flushTimer) clearTimeout(stream.flushTimer);
      if (stream.staleTimer) clearTimeout(stream.staleTimer);
      stream.source.close();
      if (streams.get(boardId) === stream) streams.delete(boardId);
    }, 1000);
  };
}

/** Says which card this tab has open on the board (null: none). */
export function setViewingCard(boardId: string, cardId: string | null) {
  const stream = streams.get(boardId);
  if (!stream) return;
  stream.cardId = cardId;
  scheduleFlush(boardId, stream);
}

/** The card this tab has open on the board, if any. */
export function getViewingCard(boardId: string): string | null {
  return streams.get(boardId)?.cardId ?? null;
}

// When this tab last asked the server for fresh board data (router.refresh()).
// A live "board changed" event that arrived before that refresh started is
// already covered by it, so the board can skip its own refetch. This keeps an
// edit from refetching the whole board twice (once after the action, once for
// the event the action itself published).
const refreshedAt = new Map<string, number>();

/** Call right before router.refresh() for this board. */
export function markBoardRefreshed(boardId: string) {
  refreshedAt.set(boardId, performance.now());
}

/** Whether a refresh started at or after `since` (a performance.now() time). */
export function refreshedSince(boardId: string, since: number): boolean {
  return (refreshedAt.get(boardId) ?? -Infinity) >= since;
}

/** Everyone currently on the board (including this user), live. */
export function useBoardViewers(boardId: string): PresenceViewer[] {
  const subscribe = useCallback(
    (notify: () => void) => subscribeBoardStream(boardId, { onPresence: notify }),
    [boardId]
  );
  return useSyncExternalStore(
    subscribe,
    () => streams.get(boardId)?.viewers ?? EMPTY,
    () => EMPTY
  );
}

/** True while the board's live stream has been disconnected for a while. */
export function useBoardStreamStale(boardId: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => subscribeBoardStream(boardId, { onStatus: notify }),
    [boardId]
  );
  return useSyncExternalStore(
    subscribe,
    () => streams.get(boardId)?.stale ?? false,
    () => false
  );
}

/** Marks a card as open in this tab for as long as the component is mounted. */
export function useViewingCard(boardId: string, cardId: string) {
  useEffect(() => {
    const unsubscribe = subscribeBoardStream(boardId, {});
    setViewingCard(boardId, cardId);
    return () => {
      setViewingCard(boardId, null);
      unsubscribe();
    };
  }, [boardId, cardId]);
}
