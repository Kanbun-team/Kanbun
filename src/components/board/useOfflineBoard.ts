"use client";

// Offline support for the board, kept out of Board.tsx:
// - the data to show: the newer of the server props and the IndexedDB
//   snapshot, with queued edits applied on top;
// - `run`: sends a card edit, or queues it in the outbox when offline (or
//   when earlier edits are still waiting, so the order is kept);
// - `guard`: for edits that can not be queued, says "you are offline";
// - opening a card offline: the stored details in a read-only panel
//   (OfflineCardSheet) instead of the server-rendered card panel;
// - whether to show the offline banner.

import { useEffect, useMemo, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { errorMessage, useUi } from "@/components/ui/UiProvider";
import { blockedOffline } from "@/components/ui/offline";
import { markBoardRefreshed, subscribeBoardStream, useBoardStreamStale } from "@/lib/board-stream";
import type { Locale } from "@/lib/i18n";
import {
  clearApplied,
  ensureUser,
  getOfflineState,
  loadSnapshot,
  pendingFor,
  prefetchBoardCards,
  queueEdit,
  saveSnapshot,
  requestSync,
  useOfflineState,
} from "@/lib/offline-store";
import { applyOutbox, referencesTempId, type OutboxOp, type RunResult } from "@/lib/outbox";
import { isOnline, useOnline } from "@/lib/use-online";
import { runOutboxOp } from "./offline-runner";
import type { ColumnDTO } from "./types";

export interface RunOutcome {
  ok: boolean;
  /** Saved in the outbox, to be sent when back online. */
  queued: boolean;
  createdIds?: string[];
  /** Automation rules the edit set off on the server (not for queued edits). */
  automation?: { runId: string; ruleName: string }[];
}

export function useOfflineBoard({
  boardId,
  userId,
  serverColumns,
  renderedAt,
  locale,
}: {
  boardId: string;
  userId: string;
  serverColumns: ColumnDTO[];
  renderedAt?: string;
  locale: Locale;
}) {
  const ui = useUi();
  const router = useRouter();
  const state = useOfflineState(userId);
  const online = useOnline();
  const streamStale = useBoardStreamStale(boardId);

  useEffect(() => {
    ensureUser(userId);
    loadSnapshot(boardId);
  }, [userId, boardId]);

  // Keep the latest server data for offline use. Fresh data also means edits
  // that were just synced no longer need to be applied on top.
  useEffect(() => {
    if (!renderedAt) return;
    ensureUser(userId);
    saveSnapshot(boardId, { columns: serverColumns, renderedAt });
    clearApplied();
  }, [userId, boardId, serverColumns, renderedAt]);

  // Lightweight details of every card, for reading cards offline that were
  // never opened (throttled in prefetchBoardCards).
  useEffect(() => {
    if (!renderedAt) return;
    ensureUser(userId);
    prefetchBoardCards(boardId);
  }, [userId, boardId, renderedAt]);

  // The live stream reconnecting is as good a sign as the "online" event.
  useEffect(
    () => subscribeBoardStream(boardId, { onOpen: requestSync }),
    [boardId]
  );

  // Offline, a card opens from its stored details (OfflineCardSheet) instead
  // of navigating to the server-rendered panel.
  const [offlineCardId, setOfflineCardId] = useState<string | null>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (isOnline()) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link) return;
      const href = link.getAttribute("href") ?? "";
      const prefix = `/tasks/${boardId}/cards/`;
      if (!href.startsWith(prefix)) return;
      e.preventDefault();
      e.stopPropagation();
      const cardId = href.slice(prefix.length).split(/[/?#]/)[0];
      if (cardId) setOfflineCardId(decodeURIComponent(cardId));
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [boardId]);

  const snapshot = state.snapshots[boardId];
  const useSnapshot = !!snapshot && (!renderedAt || snapshot.renderedAt > renderedAt);
  const base = useSnapshot ? snapshot.columns : serverColumns;
  const dataTime = useSnapshot ? snapshot.renderedAt : renderedAt;

  const columns = useMemo(() => {
    const own = [...state.applied, ...state.entries].filter((e) => e.boardId === boardId);
    return own.length > 0 ? applyOutbox(base, own, state.idMap) : base;
  }, [base, state.applied, state.entries, state.idMap, boardId]);

  function queue(op: OutboxOp, label: string): RunOutcome {
    queueEdit(boardId, op, label);
    return { ok: true, queued: true };
  }

  /** Sends a card edit now, or queues it. Shows the error toast on failure. */
  async function run(op: OutboxOp, label: string): Promise<RunOutcome> {
    const current = getOfflineState();
    if (!isOnline() || current.entries.length > 0 || current.syncing || referencesTempId(op)) {
      return queue(op, label);
    }
    let result: RunResult;
    try {
      result = await runOutboxOp(op);
    } catch (error) {
      unstable_rethrow(error);
      // The request never got an answer: keep it for later.
      return queue(op, label);
    }
    if (!result.ok) ui.toast({ message: errorMessage(result.error, locale), tone: "error" });
    // On failure the refresh rolls the optimistic change back.
    markBoardRefreshed(boardId);
    router.refresh();
    return {
      ok: result.ok,
      queued: false,
      createdIds: result.ok ? result.createdIds : undefined,
      automation: result.ok ? result.automation : undefined,
    };
  }

  /** For edits that need the server: false (with a toast) while offline. */
  function guard(): boolean {
    return !blockedOffline(ui);
  }

  /** True when the card can open online; offline it opens from stored details instead. */
  function canOpenCard(cardId: string): boolean {
    if (isOnline()) return true;
    setOfflineCardId(cardId);
    return false;
  }

  return {
    columns,
    run,
    guard,
    canOpenCard,
    /** The card shown from stored details (offline), or null. */
    offlineCardId,
    closeOfflineCard: () => setOfflineCardId(null),
    online,
    /** Show the offline banner. */
    showOffline: !online || streamStale,
    /** When the shown data was rendered by the server (ISO). */
    dataTime,
    pending: pendingFor(state, boardId),
    syncing: state.syncing,
  };
}
