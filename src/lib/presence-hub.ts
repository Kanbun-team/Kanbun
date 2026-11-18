// Entry point for board presence used by the API routes. Picks the in-memory
// registry (src/lib/presence.ts, one process) or the Redis-backed one
// (src/lib/presence-redis.ts, several instances) from REDIS_URL. The Redis
// module is only loaded when REDIS_URL is set.

import { joinPresence, setPresenceCard, type PresenceConnection } from "./presence";
import { redisEnabled } from "./redis";

type RedisPresence = typeof import("./presence-redis");

let redisPresence: Promise<RedisPresence> | undefined;
const loadRedisPresence = () => (redisPresence ??= import("./presence-redis"));

/**
 * Registers a stream's connection on a board and tells everyone on it.
 * Returns a function that removes exactly this connection.
 */
export function joinBoardPresence(boardId: string, conn: PresenceConnection): () => void {
  if (!redisEnabled()) return joinPresence(boardId, conn);
  let leave: (() => void) | undefined;
  let left = false;
  void loadRedisPresence().then((mod) => {
    if (left) return;
    leave = mod.joinPresenceRedis(boardId, conn);
  });
  return () => {
    left = true;
    leave?.();
  };
}

/**
 * Records which card a connection has open (null when none). Only the owner of
 * the connection may change it. Resolves to false when the connection is
 * unknown.
 */
export async function setBoardPresenceCard(
  boardId: string,
  connId: string,
  userId: string,
  cardId: string | null,
): Promise<boolean> {
  if (!redisEnabled()) return setPresenceCard(boardId, connId, userId, cardId);
  const mod = await loadRedisPresence();
  return mod.setPresenceCardRedis(boardId, connId, userId, cardId);
}
