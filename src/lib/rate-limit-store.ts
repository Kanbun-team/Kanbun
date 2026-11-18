// Fixed-window counters behind every rate limiter. In memory by default (one
// process). With REDIS_URL set, counters live in Redis (INCR plus an expiry set
// on the first hit), so all instances behind a load balancer share them. If
// Redis cannot be reached a call falls back to the in-memory counters of the
// instance, so a Redis outage loosens limits per instance but never blocks
// logins outright.

import { logRedisError, redisCommand, redisEnabled, redisKey } from "./redis";

export interface CounterStore {
  /** Adds one to `key`. The window starts at the first hit and lasts
   * `windowMs`. Resolves to the count within the current window. */
  increment(key: string, windowMs: number): Promise<number>;
  /** The count within the current window (0 when none). */
  get(key: string): Promise<number>;
  /** Forgets `key`. */
  reset(key: string): Promise<void>;
}

type Bucket = { count: number; resetAt: number };

/** In-process counters. Stored on globalThis so they survive HMR. */
export class MemoryCounterStore implements CounterStore {
  constructor(private readonly buckets: Map<string, Bucket> = new Map()) {}

  private live(key: string, now: number): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    this.sweep(now);
    const bucket = this.live(key, now);
    if (bucket) return ++bucket.count;
    this.buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }

  async get(key: string): Promise<number> {
    return this.live(key, Date.now())?.count ?? 0;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}

/** Counters in Redis. Keys are prefixed with `ratelimit:`. */
export class RedisCounterStore implements CounterStore {
  constructor(private readonly fallback: CounterStore) {}

  private key(key: string) {
    return redisKey(`ratelimit:${key}`);
  }

  async increment(key: string, windowMs: number): Promise<number> {
    try {
      const redis = await redisCommand()!;
      // SET NX starts the window on the first hit only; INCR then counts. Run
      // as one transaction so a crash in between cannot leave a key without
      // an expiry.
      const result = await redis
        .multi()
        .set(this.key(key), "0", "PX", windowMs, "NX")
        .incr(this.key(key))
        .exec();
      const count = result?.[1]?.[1];
      if (typeof count !== "number") throw new Error("unexpected INCR reply");
      return count;
    } catch (err) {
      logRedisError("rate limit", err);
      return this.fallback.increment(key, windowMs);
    }
  }

  async get(key: string): Promise<number> {
    try {
      const redis = await redisCommand()!;
      return Number((await redis.get(this.key(key))) ?? 0);
    } catch (err) {
      logRedisError("rate limit", err);
      return this.fallback.get(key);
    }
  }

  async reset(key: string): Promise<void> {
    await this.fallback.reset(key);
    try {
      const redis = await redisCommand()!;
      await redis.del(this.key(key));
    } catch (err) {
      logRedisError("rate limit", err);
    }
  }
}

const globalForStore = globalThis as unknown as {
  __kanbunCounterBuckets?: Map<string, Bucket>;
  __kanbunCounterStore?: { redis: boolean; store: CounterStore };
};

const memory = new MemoryCounterStore(
  globalForStore.__kanbunCounterBuckets ?? (globalForStore.__kanbunCounterBuckets = new Map()),
);

/** The store all limiters should use: Redis when REDIS_URL is set, otherwise
 * in memory. */
export function counterStore(): CounterStore {
  const redis = redisEnabled();
  const cached = globalForStore.__kanbunCounterStore;
  if (cached && cached.redis === redis) return cached.store;
  const store = redis ? new RedisCounterStore(memory) : memory;
  globalForStore.__kanbunCounterStore = { redis, store };
  return store;
}
