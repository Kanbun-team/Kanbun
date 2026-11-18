import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientIp,
  isLoginBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  trustedProxies,
} from "@/lib/rate-limit";

let n = 0;
// Unique ip per test: the limiter is module-global state.
const freshIp = () => `10.0.0.${++n}`;

describe("login rate limit", () => {
  // The in-memory counters (fake timers cannot move a Redis expiry).
  beforeAll(() => {
    delete process.env.REDIS_URL;
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("blocks an account after 10 failures from the same ip", async () => {
    const ip = freshIp();
    for (let i = 0; i < 9; i++) await recordLoginFailure(ip, "carol");
    expect(await isLoginBlocked(ip, "carol")).toBe(false);
    await recordLoginFailure(ip, "carol");
    expect(await isLoginBlocked(ip, "carol")).toBe(true);
    expect(await isLoginBlocked(freshIp(), "carol")).toBe(false);
  });

  it("unblocks after the 15 minute window", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await recordLoginFailure(ip, "dave");
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(await isLoginBlocked(ip, "dave")).toBe(false);
  });

  it("blocks an ip after 50 failures across usernames", async () => {
    const ip = freshIp();
    for (let i = 0; i < 50; i++) await recordLoginFailure(ip, `user${i}`);
    expect(await isLoginBlocked(ip, "someone-else")).toBe(true);
  });

  it("a successful login resets the account counter", async () => {
    const ip = freshIp();
    for (let i = 0; i < 9; i++) await recordLoginFailure(ip, "erin");
    await recordLoginSuccess(ip, "erin");
    await recordLoginFailure(ip, "erin");
    expect(await isLoginBlocked(ip, "erin")).toBe(false);
  });

  it("blocks a username after 100 failures spread over many ips", async () => {
    for (let i = 0; i < 99; i++) await recordLoginFailure(freshIp(), "frank");
    expect(await isLoginBlocked(freshIp(), "frank")).toBe(false);
    await recordLoginFailure(freshIp(), "frank");
    expect(await isLoginBlocked(freshIp(), "frank")).toBe(true);
    expect(await isLoginBlocked(freshIp(), "grace")).toBe(false);
  });

  it("reads the client ip from proxy headers", async () => {
    // One trusted proxy (the default): the entry it appended, on the right.
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(undefined)).toBe("unknown");
  });

  it("ignores X-Forwarded-For entries the client wrote itself", async () => {
    // The client sent "6.6.6.6, 7.7.7.7"; the proxy appended the real address.
    const spoofed = new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" });
    expect(clientIp(spoofed, 1)).toBe("203.0.113.9");
    // Two proxies (e.g. a CDN in front of nginx): the second entry from the right.
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }), 2)).toBe("203.0.113.9");
    // More hops configured than entries present: the leftmost one.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), 3)).toBe("203.0.113.9");
  });

  it("reads TRUSTED_PROXIES", () => {
    expect(trustedProxies({})).toBe(1);
    expect(trustedProxies({ TRUSTED_PROXIES: "2" })).toBe(2);
    expect(trustedProxies({ TRUSTED_PROXIES: "0" })).toBe(1);
    expect(trustedProxies({ TRUSTED_PROXIES: "nope" })).toBe(1);
  });
});
