// Cross-instance message bus over Redis pub/sub. Used by src/lib/realtime.ts
// (board and notification events) and src/lib/presence-redis.ts (viewer list
// changes). Every instance subscribes to one channel with one connection and
// fans messages out to its local listeners. A message carries the id of the
// instance that sent it, which skips it: that instance already delivered it
// locally.
//
// Without REDIS_URL every function here is a no-op.

import { INSTANCE_ID, logRedisError, redisCommand, redisEnabled, redisKey, redisSubscriber } from "./redis";

export type BusMessage =
  /** A realtime channel (board id, board list or user) has news. */
  | { kind: "event"; key: string }
  /** The viewer list of a board changed. */
  | { kind: "presence"; boardId: string };

type Handler = (message: BusMessage) => void;

const globalForBus = globalThis as unknown as {
  __kanbunRemoteHandlers?: Set<Handler>;
  __kanbunRemoteSubscribed?: Promise<void>;
};

const handlers: Set<Handler> =
  globalForBus.__kanbunRemoteHandlers ?? (globalForBus.__kanbunRemoteHandlers = new Set());

const channel = () => redisKey("events");

/** Parses a message from the channel. Null for anything malformed or sent by
 * this instance. Exported for tests. */
export function decodeBusMessage(raw: string, self: string = INSTANCE_ID): BusMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { o, m } = data as { o?: unknown; m?: unknown };
  if (o === self || !m || typeof m !== "object") return null;
  const msg = m as Record<string, unknown>;
  if (msg.kind === "event" && typeof msg.key === "string") return { kind: "event", key: msg.key };
  if (msg.kind === "presence" && typeof msg.boardId === "string") return { kind: "presence", boardId: msg.boardId };
  return null;
}

export function encodeBusMessage(message: BusMessage, self: string = INSTANCE_ID): string {
  return JSON.stringify({ o: self, m: message });
}

function ensureSubscribed(): void {
  if (globalForBus.__kanbunRemoteSubscribed) return;
  const subscriber = redisSubscriber();
  if (!subscriber) return;
  const ready = subscriber.then(async (sub) => {
    sub.on("message", (ch: string, raw: string) => {
      if (ch !== channel()) return;
      const message = decodeBusMessage(raw);
      if (!message) return;
      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
          // One broken handler must not stop the others.
        }
      }
    });
    // ioredis re-subscribes by itself after a reconnect.
    await sub.subscribe(channel());
  });
  globalForBus.__kanbunRemoteSubscribed = ready;
  ready.catch((err) => {
    logRedisError("subscribe", err);
    if (globalForBus.__kanbunRemoteSubscribed === ready) globalForBus.__kanbunRemoteSubscribed = undefined;
  });
}

/** Registers a handler for messages from other instances (and starts the
 * subscription on first use). Returns an unregister function. */
export function onRemoteMessage(handler: Handler): () => void {
  if (!redisEnabled()) return () => {};
  handlers.add(handler);
  ensureSubscribed();
  return () => {
    handlers.delete(handler);
  };
}

/** Sends a message to every other instance. Fire and forget: a Redis outage
 * only costs other instances their live updates, never the action itself. */
export function publishRemote(message: BusMessage): void {
  const command = redisCommand();
  if (!command) return;
  command
    .then((redis) => redis.publish(channel(), encodeBusMessage(message)))
    .catch((err) => logRedisError("publish", err));
}
