// In-process pub/sub for live board updates.
//
// Deliberately broker-free: a module-level map of boardId -> listeners, stored
// on globalThis so it survives Next.js HMR in development. This works for a
// single Node process, which matches Kanbun's single-binary, SQLite-backed
// deployment model. Horizontal scaling would need an external broker; that is
// out of scope on purpose.

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
};

const bus: Map<string, Set<Listener>> =
  globalForBus.__kanbunBoardBus ?? (globalForBus.__kanbunBoardBus = new Map());

export function subscribeBoard(boardId: string, listener: Listener): () => void {
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

export function publishBoard(boardId: string): void {
  emit(boardId);
}

export function publishBoardList(): void {
  emit(LIST_KEY);
}
