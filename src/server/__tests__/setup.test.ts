import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createFirstAdmin, needsSetup, validateSetup } from "@/server/setup";
import { createTestDb } from "./test-db";

describe("validateSetup", () => {
  const base = { username: "Admin", displayName: "", password: "secret1", confirm: "secret1" };

  it("normalizes the username and defaults the display name", () => {
    expect(validateSetup(base)).toEqual({
      ok: true,
      data: { username: "admin", displayName: "admin", password: "secret1" },
    });
  });

  it("rejects bad usernames, short and mismatched passwords", () => {
    expect(validateSetup({ ...base, username: "a" })).toEqual({ ok: false, error: "setupUsernameInvalid" });
    expect(validateSetup({ ...base, username: "has space" })).toEqual({ ok: false, error: "setupUsernameInvalid" });
    expect(validateSetup({ ...base, password: "12345", confirm: "12345" })).toEqual({
      ok: false,
      error: "setupPasswordShort",
    });
    expect(validateSetup({ ...base, confirm: "secret2" })).toEqual({ ok: false, error: "setupPasswordMismatch" });
  });
});

describe("createFirstAdmin", () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    ({ db, cleanup } = createTestDb());
  }, 60_000);
  afterAll(async () => {
    await cleanup();
  });

  it("only works while there are no users", async () => {
    expect(await needsSetup(db)).toBe(true);
    expect(await createFirstAdmin({ username: "root", displayName: "Root", passwordHash: "h" }, db)).toBe(true);
    expect(await needsSetup(db)).toBe(false);
    const user = await db.user.findUniqueOrThrow({ where: { username: "root" } });
    expect(user.role).toBe("admin");

    expect(await createFirstAdmin({ username: "intruder", displayName: "X", passwordHash: "h" }, db)).toBe(false);
    expect(await db.user.count()).toBe(1);
  });
});
