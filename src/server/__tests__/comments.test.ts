import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";

const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/lib/db-local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-local")>();
  return {
    ...actual,
    get prisma() {
      return holder.db;
    },
  };
});

const { CommentKeyError, createCommentOnce, parseClientKey } = await import("@/server/comments");

let cleanup: () => Promise<void>;
let db: PrismaClient;
let ada: string;
let marta: string;
let cardId: string;
let otherCardId: string;

beforeAll(async () => {
  ({ db, cleanup } = createTestDb());
  holder.db = db;
  ada = (await db.user.create({ data: { username: "ada", passwordHash: "x" } })).id;
  marta = (await db.user.create({ data: { username: "marta", passwordHash: "x" } })).id;
  const board = await db.board.create({
    data: {
      name: "Website",
      createdById: ada,
      members: { create: [{ userId: ada, role: "owner" }, { userId: marta, role: "member" }] },
      columns: { create: [{ name: "To do", position: 0 }] },
    },
    include: { columns: true },
  });
  cardId = (await db.taskCard.create({ data: { columnId: board.columns[0].id, title: "Hero", position: 0 } })).id;
  otherCardId = (await db.taskCard.create({ data: { columnId: board.columns[0].id, title: "Footer", position: 1 } }))
    .id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

const countOn = (id: string) => db.taskCardComment.count({ where: { cardId: id } });

describe("parseClientKey", () => {
  it("accepts UUIDs and the outbox's temporary ids, treats empty as none", () => {
    expect(parseClientKey("0b7c6f1e-2a4d-4f7e-9d0b-1c2d3e4f5a6b")).toBe("0b7c6f1e-2a4d-4f7e-9d0b-1c2d3e4f5a6b");
    expect(parseClientKey("tmpc_0b7c6f1e-2a4d")).toBe("tmpc_0b7c6f1e-2a4d");
    expect(parseClientKey(null)).toBeNull();
    expect(parseClientKey("  ")).toBeNull();
  });

  it("rejects keys with spaces or over 100 characters", () => {
    expect(() => parseClientKey("a b")).toThrow(CommentKeyError);
    expect(() => parseClientKey("x".repeat(101))).toThrow(CommentKeyError);
  });
});

describe("createCommentOnce", () => {
  it("returns the first comment when the same key is sent again", async () => {
    const first = await createCommentOnce({ cardId, authorId: ada, body: "Hello", clientKey: "k1" });
    const again = await createCommentOnce({ cardId, authorId: ada, body: "Hello", clientKey: "k1" });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.comment.id).toBe(first.comment.id);
    expect(await db.taskCardComment.count({ where: { cardId, clientKey: "k1" } })).toBe(1);
    // The author watches the card.
    expect(await db.cardWatcher.count({ where: { cardId, userId: ada } })).toBe(1);
  });

  it("creates one comment for two sends racing with the same key", async () => {
    const before = await countOn(cardId);
    const [a, b] = await Promise.all([
      createCommentOnce({ cardId, authorId: ada, body: "Race", clientKey: "race" }),
      createCommentOnce({ cardId, authorId: ada, body: "Race", clientKey: "race" }),
    ]);
    expect(a.comment.id).toBe(b.comment.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await countOn(cardId)).toBe(before + 1);
  });

  it("scopes keys to the card, and comments without a key are never merged", async () => {
    const here = await createCommentOnce({ cardId, authorId: ada, body: "Here", clientKey: "shared" });
    const there = await createCommentOnce({ cardId: otherCardId, authorId: ada, body: "There", clientKey: "shared" });
    expect(there.created).toBe(true);
    expect(there.comment.id).not.toBe(here.comment.id);

    const before = await countOn(cardId);
    await createCommentOnce({ cardId, authorId: ada, body: "Same", clientKey: null });
    await createCommentOnce({ cardId, authorId: ada, body: "Same", clientKey: null });
    expect(await countOn(cardId)).toBe(before + 2);
  });

  it("refuses a key that another user's comment on the card already has", async () => {
    await createCommentOnce({ cardId, authorId: ada, body: "Mine", clientKey: "taken" });
    await expect(createCommentOnce({ cardId, authorId: marta, body: "Theirs", clientKey: "taken" })).rejects.toThrow(
      CommentKeyError
    );
  });
});
