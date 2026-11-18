// In-memory presence: who is looking at which board, and which card they have
// open. Like src/lib/realtime.ts it lives on globalThis (survives HMR) and is
// scoped to a single Node process, which matches Kanbun's deployment model.
//
// Each open board event stream is one connection. A person with three tabs
// open has three connections but shows up once in the viewer list. Nothing is
// persisted: when the stream closes, the connection is gone.

export type PresenceViewer = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Cards this person has open on the board (one per tab at most). */
  cardIds: string[];
};

export type PresenceConnection = {
  connId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  cardId: string | null;
  /** Called with the board's viewer list whenever it changes. */
  notify: (viewers: PresenceViewer[]) => void;
};

type BoardConnections = Map<string, PresenceConnection>;

const globalForPresence = globalThis as unknown as {
  __kanbunPresence?: Map<string, BoardConnections>;
};

const registry: Map<string, BoardConnections> =
  globalForPresence.__kanbunPresence ?? (globalForPresence.__kanbunPresence = new Map());

/** Deduplicated viewers of a board, in the order they first arrived. */
export function listViewers(boardId: string): PresenceViewer[] {
  const conns = registry.get(boardId);
  if (!conns) return [];
  const byUser = new Map<string, PresenceViewer>();
  for (const conn of conns.values()) {
    let viewer = byUser.get(conn.userId);
    if (!viewer) {
      viewer = { id: conn.userId, name: conn.name, avatarUrl: conn.avatarUrl, cardIds: [] };
      byUser.set(conn.userId, viewer);
    }
    if (conn.cardId && !viewer.cardIds.includes(conn.cardId)) viewer.cardIds.push(conn.cardId);
  }
  return [...byUser.values()];
}

function broadcast(boardId: string): void {
  const conns = registry.get(boardId);
  if (!conns) return;
  const viewers = listViewers(boardId);
  for (const conn of conns.values()) {
    try {
      conn.notify(viewers);
    } catch {
      // A broken stream must not stop the others from hearing about it.
    }
  }
}

/**
 * Registers a connection on a board and tells everyone on it. Returns a
 * function that removes exactly this connection (a reconnect that reused the
 * same connId is left alone).
 */
export function joinPresence(boardId: string, conn: PresenceConnection): () => void {
  let conns = registry.get(boardId);
  if (!conns) {
    conns = new Map();
    registry.set(boardId, conns);
  }
  conns.set(conn.connId, conn);
  broadcast(boardId);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = registry.get(boardId);
    if (!current || current.get(conn.connId) !== conn) return;
    current.delete(conn.connId);
    if (current.size === 0) registry.delete(boardId);
    else broadcast(boardId);
  };
}

/**
 * Records which card a connection has open (null when none). Only the owner of
 * the connection may change it. Returns false when the connection is unknown.
 */
export function setPresenceCard(boardId: string, connId: string, userId: string, cardId: string | null): boolean {
  const conn = registry.get(boardId)?.get(connId);
  if (!conn || conn.userId !== userId) return false;
  if (conn.cardId === cardId) return true;
  conn.cardId = cardId;
  broadcast(boardId);
  return true;
}

/** Test helper: forget everything. */
export function resetPresence(): void {
  registry.clear();
}
