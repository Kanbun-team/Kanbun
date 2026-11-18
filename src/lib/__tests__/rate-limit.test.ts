import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientIp,
  isLoginBlocked,
  recordLoginFailure,
  recordLoginSuccess,
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

  it("reads the client ip from proxy headers", async () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
