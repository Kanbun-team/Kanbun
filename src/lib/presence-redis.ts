// Presence shared by several Kanbun instances through Redis (REDIS_URL).
//
// Per board, two hashes keyed by connection id:
//   presence:<boardId>       -> JSON { userId, name, avatarUrl, cardId, joinedAt }
//   presence:<boardId>:seen  -> expiry time in ms
// Each instance refreshes the expiry of its own open streams every 20 s, so the
// connections of an instance that crashed disappear after at most a minute.
// Any change is announced on the bus (src/lib/redis-bus.ts); every instance
// with viewers on that board then re-reads the hashes and pushes the new list
// to its own streams.
//
// The card a connection has open can be changed by a request that reaches a
// different instance than the stream itself, so the card lives in Redis, and
// the owner check (same user) happens there too.

import type { Redis } from "ioredis";
import { viewersOf, type PresenceConnection, type PresenceViewer } from "./presence";
import { logRedisError, redisCommand, redisKey } from "./redis";
import { onRemoteMessage, publishRemote } from "./redis-bus";

const TTL_MS = 60_000;
const REFRESH_MS = 20_000;

export type StoredConnection = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  cardId: string | null;
  joinedAt: number;
};

const infoKey = (boardId: string) => redisKey(`presence:${boardId}`);
const seenKey = (boardId: string) => redisKey(`presence:${boardId}:seen`);

const globalForPresence = globalThis as unknown as {
  __kanbunRedisPresence?: Map<string, Map<string, PresenceConnection>>;
  __kanbunRedisPresenceTimer?: ReturnType<typeof setInterval>;
  __kanbunRedisPresenceRemote?: boolean;
};

/** Streams open on this instance, per board. */
const local: Map<string, Map<string, PresenceConnection>> =
  globalForPresence.__kanbunRedisPresence ?? (globalForPresence.__kanbunRedisPresence = new Map());

function parse(raw: string | undefined | null): StoredConnection | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredConnection;
    return value && typeof value.userId === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Live connections from the two hashes, oldest first, plus the ids that have
 * expired. Pure, exported for tests.
 */
export function liveConnections(
  info: Record<string, string>,
  seen: Record<string, string>,
  now: number,
): { live: StoredConnection[]; stale: string[] } {
  const live: (StoredConnection & { connId: string })[] = [];
  const stale: string[] = [];
  for (const [connId, raw] of Object.entries(info)) {
    const conn = parse(raw);
    const expires = Number(seen[connId] ?? 0);
    if (!conn || !(expires > now)) stale.push(connId);
    else live.push({ ...conn, connId });
  }
  for (const connId of Object.keys(seen)) if (!(connId in info)) stale.push(connId);
  live.sort((a, b) => a.joinedAt - b.joinedAt || a.connId.localeCompare(b.connId));
  return { live, stale };
}

async function readViewers(redis: Redis, boardId: string): Promise<{ viewers: PresenceViewer[]; stale: string[] }> {
  const [info, seen] = await Promise.all([redis.hgetall(infoKey(boardId)), redis.hgetall(seenKey(boardId))]);
  const { live, stale } = liveConnections(info, seen, Date.now());
  if (stale.length > 0) {
    await redis.multi().hdel(infoKey(boardId), ...stale).hdel(seenKey(boardId), ...stale).exec();
  }
  return { viewers: viewersOf(live), stale };
}

/** Pushes the board's current viewer list to the streams on this instance. */
async function notifyLocal(boardId: string): Promise<number> {
  const conns = local.get(boardId);
  const command = redisCommand();
  if (!conns || conns.size === 0 || !command) return 0;
  const redis = await command;
  const { viewers, stale } = await readViewers(redis, boardId);
  for (const conn of conns.values()) {
    try {
      conn.notify(viewers);
    } catch {
      // A broken stream must not stop the others from hearing about it.
    }
  }
  return stale.length;
}

/** Tells every instance (this one included) that the board's viewers changed. */
async function changed(boardId: string): Promise<void> {
  publishRemote({ kind: "presence", boardId });
  await notifyLocal(boardId);
}

function refreshAll(): void {
  const command = redisCommand();
  if (!command) return;
  void command
    .then(async (redis) => {
      const expires = String(Date.now() + TTL_MS);
      for (const [boardId, conns] of local) {
        if (conns.size === 0) continue;
        const multi = redis.multi();
        for (const connId of conns.keys()) multi.hset(seenKey(boardId), connId, expires);
        multi.pexpire(infoKey(boardId), TTL_MS * 2).pexpire(seenKey(boardId), TTL_MS * 2);
        await multi.exec();
        // Drops viewers of instances that went away, and tells everyone.
        const { stale } = await readViewers(redis, boardId);
        if (stale.length > 0) await changed(boardId);
      }
    })
    .catch((err) => logRedisError("presence refresh", err));
}

function start(): void {
  if (!globalForPresence.__kanbunRedisPresenceRemote) {
    globalForPresence.__kanbunRedisPresenceRemote = true;
    onRemoteMessage((message) => {
      if (message.kind !== "presence") return;
      notifyLocal(message.boardId).catch((err) => logRedisError("presence notify", err));
    });
  }
  if (!globalForPresence.__kanbunRedisPresenceTimer) {
    const timer = setInterval(refreshAll, REFRESH_MS);
    timer.unref?.();
    globalForPresence.__kanbunRedisPresenceTimer = timer;
  }
}

export function joinPresenceRedis(boardId: string, conn: PresenceConnection): () => void {
  start();
  let conns = local.get(boardId);
  if (!conns) {
    conns = new Map();
    local.set(boardId, conns);
  }
  conns.set(conn.connId, conn);

  const stored: StoredConnection = {
    userId: conn.userId,
    name: conn.name,
    avatarUrl: conn.avatarUrl,
    cardId: conn.cardId,
    joinedAt: Date.now(),
  };
  const joined = redisCommand()!
    .then(async (redis) => {
      await redis
        .multi()
        .hset(infoKey(boardId), conn.connId, JSON.stringify(stored))
        .hset(seenKey(boardId), conn.connId, String(Date.now() + TTL_MS))
        .pexpire(infoKey(boardId), TTL_MS * 2)
        .pexpire(seenKey(boardId), TTL_MS * 2)
        .exec();
      await changed(boardId);
    })
    .catch((err) => logRedisError("presence join", err));

  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = local.get(boardId);
    if (!current || current.get(conn.connId) !== conn) return;
    current.delete(conn.connId);
    if (current.size === 0) local.delete(boardId);
    void joined
      .then(() => redisCommand())
      .then(async (redis) => {
        if (!redis) return;
        await redis.multi().hdel(infoKey(boardId), conn.connId).hdel(seenKey(boardId), conn.connId).exec();
        await changed(boardId);
      })
      .catch((err) => logRedisError("presence leave", err));
  };
}

/** Same contract as setPresenceCard in src/lib/presence.ts, for any instance. */
export async function setPresenceCardRedis(
  boardId: string,
  connId: string,
  userId: string,
  cardId: string | null,
): Promise<boolean> {
  const command = redisCommand();
  if (!command) return false;
  try {
    const redis = await command;
    const conn = parse(await redis.hget(infoKey(boardId), connId));
    if (!conn || conn.userId !== userId) return false;
    if (conn.cardId === cardId) return true;
    conn.cardId = cardId;
    await redis.hset(infoKey(boardId), connId, JSON.stringify(conn));
    await changed(boardId);
    return true;
  } catch (err) {
    logRedisError("presence card", err);
    return false;
  }
}
