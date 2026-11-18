// Generic fixed-window rate limiter behind a small async interface, so a
// shared store (for example Redis, when several instances run behind a load
// balancer) can replace the in-memory default with `setLimiter()`.
//
// The in-memory implementation is single-process by design, like the
// realtime bus. It lives on globalThis so it survives HMR in development.

export interface LimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds when the current window ends. */
  resetAt: number;
}

export interface Limiter {
  /** Counts one hit for `key` and reports whether it is within `limit` per `windowMs`. */
  hit(key: string, limit: number, windowMs: number): Promise<LimitResult>;
}

import { counterStore, type CounterStore } from "./rate-limit-store";
import { redisEnabled } from "./redis";

type Bucket = { count: number; resetAt: number };

export class MemoryLimiter implements Limiter {
  private buckets = new Map<string, Bucket>();

  constructor(private now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<LimitResult> {
    const now = this.now();
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

const globalForLimiter = globalThis as unknown as { __kanbunLimiter?: Limiter };

/** Limiter on the shared counter store (Redis when REDIS_URL is set). */
export class StoreLimiter implements Limiter {
  constructor(private store: CounterStore, private now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<LimitResult> {
    const count = await this.store.increment(`limiter:${key}`, windowMs);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      // The store does not report the window start; the end is at most one window away.
      resetAt: this.now() + windowMs,
    };
  }
}

export function getLimiter(): Limiter {
  return (globalForLimiter.__kanbunLimiter ??= redisEnabled() ? new StoreLimiter(counterStore()) : new MemoryLimiter());
}

/** Replace the process-wide limiter (for a shared store). */
export function setLimiter(limiter: Limiter): void {
  globalForLimiter.__kanbunLimiter = limiter;
}
