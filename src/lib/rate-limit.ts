// In-memory fixed-window limiter for failed login attempts.
//
// Single-process by design, like the realtime bus: Kanbun runs as one Node
// process on SQLite. Stored on globalThis so it survives HMR in development.

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
// Failures allowed per (ip, username) pair and per ip within one window.
const MAX_PER_ACCOUNT = 10;
const MAX_PER_IP = 50;

const globalForLimiter = globalThis as unknown as {
  __kanbunLoginLimiter?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> =
  globalForLimiter.__kanbunLoginLimiter ??
  (globalForLimiter.__kanbunLoginLimiter = new Map());

function live(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt <= now) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

function bump(key: string, now: number): void {
  const bucket = live(key, now);
  if (bucket) bucket.count += 1;
  else buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
}

function sweep(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

const accountKey = (ip: string, username: string) => `acct:${ip}:${username}`;
const ipKey = (ip: string) => `ip:${ip}`;

export function isLoginBlocked(ip: string, username: string): boolean {
  const now = Date.now();
  return (
    (live(accountKey(ip, username), now)?.count ?? 0) >= MAX_PER_ACCOUNT ||
    (live(ipKey(ip), now)?.count ?? 0) >= MAX_PER_IP
  );
}

export function recordLoginFailure(ip: string, username: string): void {
  const now = Date.now();
  sweep(now);
  bump(accountKey(ip, username), now);
  bump(ipKey(ip), now);
}

export function recordLoginSuccess(ip: string, username: string): void {
  buckets.delete(accountKey(ip, username));
}

export function clientIp(headers: Headers | undefined): string {
  return (
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
