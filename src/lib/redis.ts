// Optional Redis connection, for running several Kanbun instances behind a
// load balancer (docs/SCALING.md). Set REDIS_URL to turn it on. Without it
// nothing here connects and the ioredis package is never loaded: the realtime
// bus, presence, rate limits and job scheduling stay in-process, as in a
// single-instance install.
//
// Each process opens at most two connections: one for commands and one for
// pub/sub (a subscribed connection cannot run other commands).

import type { Redis } from "ioredis";

export function redisEnabled(): boolean {
  return !!process.env.REDIS_URL?.trim();
}

/** Prefix for every key and channel, so several deployments can share one
 * Redis. Set KANBUN_REDIS_PREFIX to change it. */
export function redisKey(name: string): string {
  return `${process.env.KANBUN_REDIS_PREFIX || "kanbun:"}${name}`;
}

type Role = "command" | "subscriber";

const globalForRedis = globalThis as unknown as {
  __kanbunInstanceId?: string;
  __kanbunRedis?: Partial<Record<Role, Promise<Redis>>>;
  __kanbunRedisLoggedAt?: number;
};

/** Identifies this process in pub/sub messages and locks. */
export const INSTANCE_ID: string =
  globalForRedis.__kanbunInstanceId ?? (globalForRedis.__kanbunInstanceId = crypto.randomUUID());

const clients = globalForRedis.__kanbunRedis ?? (globalForRedis.__kanbunRedis = {});

/** Logs Redis trouble at most once a minute: ioredis reports every failed
 * reconnect, which would flood the log during an outage. */
export function logRedisError(context: string, err: unknown): void {
  const now = Date.now();
  if (now - (globalForRedis.__kanbunRedisLoggedAt ?? 0) < 60_000) return;
  globalForRedis.__kanbunRedisLoggedAt = now;
  console.error(`[redis] ${context}:`, err instanceof Error ? err.message : err);
}

async function connect(role: Role): Promise<Redis> {
  const { default: IORedis } = await import("ioredis");
  const client = new IORedis(process.env.REDIS_URL!.trim(), {
    connectionName: `kanbun-${role}`,
    // Fail fast instead of queueing forever: every caller has a fallback.
    maxRetriesPerRequest: role === "command" ? 2 : null,
    enableReadyCheck: true,
  });
  client.on("error", (err) => logRedisError(role, err));
  return client;
}

function get(role: Role): Promise<Redis> | null {
  if (!redisEnabled()) return null;
  let client = clients[role];
  if (!client) {
    client = connect(role);
    clients[role] = client;
    // A failed import or bad URL must not stay cached as a rejected promise.
    client.catch((err) => {
      logRedisError(`connect ${role}`, err);
      if (clients[role] === client) delete clients[role];
    });
  }
  return client;
}

/** The command connection, or null when REDIS_URL is not set. */
export function redisCommand(): Promise<Redis> | null {
  return get("command");
}

/** The pub/sub connection, or null when REDIS_URL is not set. */
export function redisSubscriber(): Promise<Redis> | null {
  return get("subscriber");
}
