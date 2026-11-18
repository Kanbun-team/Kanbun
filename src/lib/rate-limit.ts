// Fixed-window limiter for failed login attempts.
//
// Counters come from src/lib/rate-limit-store.ts: in memory for a single
// process, shared in Redis when REDIS_URL is set (several instances). Other
// limiters should use counterStore() from there too.

import { counterStore } from "./rate-limit-store";

const WINDOW_MS = 15 * 60 * 1000;
// Failures allowed per (ip, username) pair and per ip within one window.
const MAX_PER_ACCOUNT = 10;
const MAX_PER_IP = 50;
// Failures allowed per username from all addresses together: a backstop for
// guessing spread over many addresses (or a client that can pick its address
// because the app is reachable without a reverse proxy).
const MAX_PER_USERNAME = 100;

const accountKey = (ip: string, username: string) => `login:acct:${ip}:${username}`;
const ipKey = (ip: string) => `login:ip:${ip}`;
const userKey = (username: string) => `login:user:${username}`;

export async function isLoginBlocked(ip: string, username: string): Promise<boolean> {
  const store = counterStore();
  const [account, total, user] = await Promise.all([
    store.get(accountKey(ip, username)),
    store.get(ipKey(ip)),
    store.get(userKey(username)),
  ]);
  return account >= MAX_PER_ACCOUNT || total >= MAX_PER_IP || user >= MAX_PER_USERNAME;
}

export async function recordLoginFailure(ip: string, username: string): Promise<void> {
  const store = counterStore();
  await Promise.all([
    store.increment(accountKey(ip, username), WINDOW_MS),
    store.increment(ipKey(ip), WINDOW_MS),
    store.increment(userKey(username), WINDOW_MS),
  ]);
}

export async function recordLoginSuccess(ip: string, username: string): Promise<void> {
  await counterStore().reset(accountKey(ip, username));
}

/** Reverse proxies in front of the app, from TRUSTED_PROXIES (default 1). */
export function trustedProxies(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRUSTED_PROXIES);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
}

/**
 * The client address for rate limits and the audit log. Every proxy appends
 * the address it was connected from to X-Forwarded-For, so only the entries
 * on the right were written by proxies we run; anything further left was sent
 * by the client and can be forged. With TRUSTED_PROXIES=n the n-th entry from
 * the right is used. Next.js fills the header from the socket when no proxy
 * sent one.
 */
export function clientIp(headers: Headers | undefined, hops: number = trustedProxies()): string {
  const forwarded = (headers?.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwarded.length > 0) return forwarded[Math.max(0, forwarded.length - hops)];
  return headers?.get("x-real-ip")?.trim() || "unknown";
}
