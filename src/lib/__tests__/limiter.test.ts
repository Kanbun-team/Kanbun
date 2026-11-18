import { describe, expect, it } from "vitest";
import { MemoryLimiter } from "@/lib/limiter";

describe("MemoryLimiter", () => {
  it("allows up to the limit per window, then resets", async () => {
    let now = 1_000;
    const limiter = new MemoryLimiter(() => now);
    for (let i = 0; i < 3; i++) {
      const r = await limiter.hit("k", 3, 60_000);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(2 - i);
    }
    const blocked = await limiter.hit("k", 3, 60_000);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0, limit: 3, resetAt: 61_000 });
    expect((await limiter.hit("other", 3, 60_000)).allowed).toBe(true);
    now = 61_000;
    expect((await limiter.hit("k", 3, 60_000)).allowed).toBe(true);
  });
});
