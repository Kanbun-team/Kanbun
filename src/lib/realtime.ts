// Pub/sub for live board updates.
//
// In-process by default: a module-level map of key -> listeners, stored on
// globalThis so it survives Next.js HMR in development. That is all a single
// Kanbun process needs. With REDIS_URL set (several instances behind a load
// balancer, see docs/SCALING.md) every publish is also sent over Redis, and
// each instance delivers what the others publish to its own listeners, so an
// SSE client on any instance hears about changes made on any other.

import { onRemoteMessage, publishRemote } from "./redis-bus";

export type BoardEvent = {
  type: "board";
  at: number;
};

type Listener = (event: BoardEvent) => void;

// The boards list (the /tasks index) is a single shared channel rather than
// keyed per board: reordering, creating, archiving, or renaming any board
// affects the whole grid. Events carry no board data, only a "refetch" signal,
// so the per-user filtering still happens server-side on refresh.
const LIST_KEY = "__board_list__";

const globalForBus = globalThis as unknown as {
  __kanbunBoardBus?: Map<string, Set<Listener>>;
  __kanbunBoardBusRemote?: boolean;
};

const bus: Map<string, Set<Listener>> =
  globalForBus.__kanbunBoardBus ?? (globalForBus.__kanbunBoardBus = new Map());

// Starts delivering other instances' events (Redis only, once per process).
function listenRemote(): void {
  if (globalForBus.__kanbunBoardBusRemote) return;
  globalForBus.__kanbunBoardBusRemote = true;
  onRemoteMessage((message) => {
    if (message.kind === "event") emit(message.key);
  });
}

export function subscribeBoard(boardId: string, listener: Listener): () => void {
  listenRemote();
  let listeners = bus.get(boardId);
  if (!listeners) {
    listeners = new Set();
    bus.set(boardId, listeners);
  }
  listeners.add(listener);
  return () => {
    const set = bus.get(boardId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) bus.delete(boardId);
  };
}

export function subscribeBoardList(listener: Listener): () => void {
  return subscribeBoard(LIST_KEY, listener);
}

// Per-user channel for notifications. Namespaced so it can never collide with
// a board id key.
export function subscribeUser(userId: string, listener: Listener): () => void {
  return subscribeBoard(`user:${userId}`, listener);
}

function emit(key: string): void {
  const listeners = bus.get(key);
  if (!listeners || listeners.size === 0) return;
  const event: BoardEvent = { type: "board", at: Date.now() };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not take down the others or the action.
    }
  }
}

function publish(key: string): void {
  emit(key);
  publishRemote({ kind: "event", key });
}

export function publishBoard(boardId: string): void {
  publish(boardId);
}

export function publishBoardList(): void {
  publish(LIST_KEY);
}

export function publishUser(userId: string): void {
  publish(`user:${userId}`);
}
