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

const accountKey = (ip: string, username: string) => `login:acct:${ip}:${username}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

export async function isLoginBlocked(ip: string, username: string): Promise<boolean> {
  const store = counterStore();
  const [account, total] = await Promise.all([store.get(accountKey(ip, username)), store.get(ipKey(ip))]);
  return account >= MAX_PER_ACCOUNT || total >= MAX_PER_IP;
}

export async function recordLoginFailure(ip: string, username: string): Promise<void> {
  const store = counterStore();
  await Promise.all([store.increment(accountKey(ip, username), WINDOW_MS), store.increment(ipKey(ip), WINDOW_MS)]);
}

export async function recordLoginSuccess(ip: string, username: string): Promise<void> {
  await counterStore().reset(accountKey(ip, username));
}

export function clientIp(headers: Headers | undefined): string {
  return (
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
