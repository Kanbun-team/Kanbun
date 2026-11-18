import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerFromUrl, textFilter } from "@/lib/db-provider";
import { redisCommand, redisEnabled, redisKey, redisSubscriber } from "@/lib/redis";
import { decodeBusMessage, encodeBusMessage, onRemoteMessage, publishRemote } from "@/lib/redis-bus";
import { counterStore, MemoryCounterStore, RedisCounterStore } from "@/lib/rate-limit-store";
import { liveConnections } from "@/lib/presence-redis";
import { listViewers, resetPresence } from "@/lib/presence";
import { joinBoardPresence, setBoardPresenceCard } from "@/lib/presence-hub";
import { claimJobRun, lockTtlMs } from "@/server/jobs/lock";
import { publishBoard, subscribeBoard } from "@/lib/realtime";
import { buildTsQuery } from "@/lib/search-query";

describe("database provider", () => {
  it("picks PostgreSQL only for postgres URLs", () => {
    expect(providerFromUrl("postgresql://u:p@db:5432/kanbun")).toBe("postgres");
    expect(providerFromUrl("postgres://db/kanbun")).toBe("postgres");
    expect(providerFromUrl(" POSTGRESQL://db/kanbun")).toBe("postgres");
    expect(providerFromUrl("file:./dev.db")).toBe("sqlite");
    expect(providerFromUrl(undefined)).toBe("sqlite");
    expect(providerFromUrl("")).toBe("sqlite");
  });

  it("case-insensitive text filters: plain on SQLite, mode insensitive on PostgreSQL", () => {
    expect(textFilter("contains", "Nav", "sqlite")).toEqual({ contains: "Nav" });
    expect(textFilter("startsWith", "Nav", "postgres")).toEqual({ startsWith: "Nav", mode: "insensitive" });
    expect(textFilter("endsWith", "bar", "postgres")).toEqual({ endsWith: "bar", mode: "insensitive" });
  });
});

describe("PostgreSQL search query", () => {
  it("requires every folded term as a prefix", () => {
    expect(buildTsQuery("Źródeł danych")).toBe("'zrodel':* & 'danych':*");
    expect(buildTsQuery("nav-bar v2")).toBe("'nav':* & 'bar':* & 'v2':*");
  });

  it("drops tsquery syntax and returns null when nothing is left", () => {
    expect(buildTsQuery("a & !b | c:* 'd'")).toBe("'a':* & 'b':* & 'c':* & 'd':*");
    expect(buildTsQuery("  !&|()  ")).toBeNull();
  });
});

describe("without REDIS_URL", () => {
  const saved = process.env.REDIS_URL;
  beforeEach(() => {
    delete process.env.REDIS_URL;
    resetPresence();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved;
  });

  it("connects to nothing", () => {
    expect(redisEnabled()).toBe(false);
    expect(redisCommand()).toBeNull();
    expect(redisSubscriber()).toBeNull();
    expect(() => publishRemote({ kind: "event", key: "b1" })).not.toThrow();
    expect(typeof onRemoteMessage(() => {})).toBe("function");
  });

  it("delivers board events in process", () => {
    const seen: number[] = [];
    const off = subscribeBoard("board-local", (e) => seen.push(e.at));
    publishBoard("board-local");
    off();
    publishBoard("board-local");
    expect(seen).toHaveLength(1);
  });

  it("keeps counters in memory", () => {
    expect(counterStore()).toBeInstanceOf(MemoryCounterStore);
  });

  it("runs every job round", async () => {
    expect(await claimJobRun("digest", 60_000)).toBe(true);
    expect(await claimJobRun("digest", 60_000)).toBe(true);
  });

  it("uses the in-memory presence registry", async () => {
    const notify = vi.fn();
    const leave = joinBoardPresence("b1", { connId: "conn-0001", userId: "u1", name: "Ada", avatarUrl: null, cardId: null, notify });
    expect(listViewers("b1")).toEqual([{ id: "u1", name: "Ada", avatarUrl: null, cardIds: [] }]);
    expect(await setBoardPresenceCard("b1", "conn-0001", "u2", "c1")).toBe(false);
    expect(await setBoardPresenceCard("b1", "conn-0001", "u1", "c1")).toBe(true);
    expect(listViewers("b1")[0].cardIds).toEqual(["c1"]);
    leave();
    expect(listViewers("b1")).toEqual([]);
  });
});

describe("memory counter store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts within a fixed window and resets", async () => {
    const store = new MemoryCounterStore();
    expect(await store.increment("k", 1000)).toBe(1);
    expect(await store.increment("k", 1000)).toBe(2);
    expect(await store.get("k")).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(await store.get("k")).toBe(0);
    await store.increment("k", 1000);
    await store.reset("k");
    expect(await store.get("k")).toBe(0);
  });
});

describe("bus messages", () => {
  it("round-trips and ignores this instance's own messages", () => {
    const raw = encodeBusMessage({ kind: "presence", boardId: "b1" }, "other");
    expect(decodeBusMessage(raw, "me")).toEqual({ kind: "presence", boardId: "b1" });
    expect(decodeBusMessage(raw, "other")).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(decodeBusMessage("not json", "me")).toBeNull();
    expect(decodeBusMessage(JSON.stringify({ o: "x", m: { kind: "event" } }), "me")).toBeNull();
    expect(decodeBusMessage(JSON.stringify({ o: "x", m: { kind: "nope", key: "a" } }), "me")).toBeNull();
    expect(decodeBusMessage("null", "me")).toBeNull();
  });
});

describe("Redis presence entries", () => {
  it("keeps live connections oldest first and reports expired ones", () => {
    const entry = (userId: string, joinedAt: number) => JSON.stringify({ userId, name: userId, avatarUrl: null, cardId: null, joinedAt });
    const { live, stale } = liveConnections(
      { a: entry("u1", 20), b: entry("u2", 10), c: entry("u3", 5), d: "garbage" },
      { a: "2000", b: "2000", c: "500", e: "2000" },
      1000,
    );
    expect(live.map((c) => c.userId)).toEqual(["u2", "u1"]);
    expect(stale.sort()).toEqual(["c", "d", "e"]);
  });
});

describe("job lock", () => {
  it("lasts most of the interval", () => {
    expect(lockTtlMs(60_000)).toBe(54_000);
    expect(lockTtlMs(500)).toBe(1_000);
  });
});

// Runs against a real Redis when TEST_REDIS_URL is set (the PostgreSQL CI job).
const testRedis = process.env.TEST_REDIS_URL;
describe.skipIf(!testRedis)("with Redis", () => {
  const saved = { url: process.env.REDIS_URL, prefix: process.env.KANBUN_REDIS_PREFIX };
  beforeEach(() => {
    process.env.REDIS_URL = testRedis;
    process.env.KANBUN_REDIS_PREFIX = `kanbun-test-${process.pid}-${Date.now()}:`;
  });
  afterAll(async () => {
    const redis = await redisCommand();
    const sub = await redisSubscriber();
    redis?.disconnect();
    sub?.disconnect();
    process.env.REDIS_URL = saved.url;
    process.env.KANBUN_REDIS_PREFIX = saved.prefix;
    if (saved.url === undefined) delete process.env.REDIS_URL;
    if (saved.prefix === undefined) delete process.env.KANBUN_REDIS_PREFIX;
  });

  it("shares counters through Redis with an expiry", async () => {
    const store = counterStore();
    expect(store).toBeInstanceOf(RedisCounterStore);
    expect(await store.increment("k", 5_000)).toBe(1);
    expect(await store.increment("k", 5_000)).toBe(2);
    expect(await store.get("k")).toBe(2);
    const redis = (await redisCommand())!;
    const ttl = await redis.pttl(redisKey("ratelimit:k"));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5_000);
    await store.reset("k");
    expect(await store.get("k")).toBe(0);
  });

  it("lets only one instance claim a job round", async () => {
    expect(await claimJobRun("digest", 60_000)).toBe(true);
    expect(await claimJobRun("digest", 60_000)).toBe(false);
  });

  it("delivers messages from other instances", async () => {
    const received = new Promise((resolve) => onRemoteMessage((m) => resolve(m)));
    const redis = (await redisCommand())!;
    // Give the subscriber a moment to subscribe, then publish as another instance.
    await new Promise((r) => setTimeout(r, 200));
    await redis.publish(redisKey("events"), encodeBusMessage({ kind: "event", key: "board-x" }, "another-instance"));
    await expect(received).resolves.toEqual({ kind: "event", key: "board-x" });
  });
});
