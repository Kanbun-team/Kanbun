import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import fixture from "@/lib/__tests__/fixtures/trello-board.json";
import { mapTrelloBoard } from "@/lib/transfer/trello";
import { exportBoardSchema, kanbunExportSchema } from "@/lib/transfer/format";
import { parseCsv } from "@/lib/csv";
import { guessMapping, planCsvImport } from "@/lib/transfer/csv-import";
import { createTestDb } from "./test-db";

const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/lib/db-local", () => ({
  get prisma() {
    return holder.db;
  },
}));

const { importBoards, writeCsvPlan } = await import("@/server/transfer/import");
const { boardCardsCsv, exportBoard } = await import("@/server/transfer/export");
const { tarHeader, tarStream } = await import("@/server/backup");

let cleanup: () => Promise<void>;
let admin: { id: string; username: string };
const originallyBy = (name: string, date: string) => `Originally by ${name} on ${date}`;

beforeAll(async () => {
  let db: PrismaClient;
  ({ db, cleanup } = createTestDb());
  holder.db = db;
  const a = await db.user.create({ data: { username: "admin", passwordHash: "x", role: "admin" } });
  await db.user.create({ data: { username: "marta", passwordHash: "x", displayName: "Marta" } });
  admin = { id: a.id, username: a.username };
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("board import and export", () => {
  it("imports a Trello board, then exports and re-imports it unchanged", async () => {
    const mapped = mapTrelloBoard(fixture, { originallyBy });
    const [first] = await importBoards([exportBoardSchema.parse(mapped.board)], admin, originallyBy);
    expect(first.stats).toMatchObject({ columns: 2, cards: 3, comments: 2, checklistItems: 3, tags: 3, members: 2 });
    expect(first.stats.unmatchedUsers).toEqual(["ghost_user"]);

    const db = holder.db;
    const landing = await db.taskCard.findFirstOrThrow({
      where: { title: "Design the landing page" },
      include: { assignees: { include: { user: true } }, subtasks: { orderBy: { position: "asc" } }, tags: { include: { tag: true } } },
    });
    expect(landing.assignees.map((a) => a.user.username)).toEqual(["marta"]);
    expect(landing.subtasks.map((s) => [s.title, s.done])).toEqual([
      ["Build: Wireframe", true],
      ["Build: Mobile layout", false],
      ["Review: Copy review", false],
    ]);
    expect(landing.deadline?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    const comment = await db.taskCardComment.findFirstOrThrow({ where: { body: { contains: "First comment" } } });
    expect(comment.authorId).toBe(admin.id);
    expect(comment.body.startsWith("Originally by Marta Nowak on 2026-10-01")).toBe(true);
    const members = await db.boardMember.findMany({ where: { boardId: first.boardId }, include: { user: true } });
    expect(members.map((m) => [m.user.username, m.role]).sort()).toEqual([
      ["admin", "owner"],
      ["marta", "member"],
    ]);

    const exported = await exportBoard(first.boardId);
    expect(exported).not.toBeNull();
    const parsed = kanbunExportSchema.parse(JSON.parse(JSON.stringify(exported)));
    expect(parsed.format).toBe("kanbun-export");
    expect(parsed.boards[0].columns.map((c) => c.cards.map((card) => card.title))).toEqual([
      ["Write the brief", "Design the landing page"],
      ["Build the signup flow"],
    ]);

    const [second] = await importBoards(parsed.boards, admin, originallyBy);
    const again = await exportBoard(second.boardId);
    const strip = (data: typeof exported) =>
      data!.boards[0].columns.map((c) =>
        c.cards!.map((card) => ({
          title: card.title,
          description: card.description,
          priority: card.priority,
          coverColor: card.coverColor,
          deadline: card.deadline,
          createdBy: card.createdBy,
          tags: card.tags,
          assignees: card.assignees,
          checklist: card.checklist,
          comments: card.comments!.map(({ body, author }) => ({ body, author })),
        }))
      );
    expect(strip(again)).toEqual(strip(exported));
    // Comments by known users keep their author instead of gaining a second prefix.
    expect(again!.boards[0].columns[1].cards![0].comments![0].body).toBe(
      "Originally by Marta Nowak on 2026-10-01\n\nFirst comment"
    );
  });

  it("carries automation rules through export and import by name", async () => {
    const board = exportBoardSchema.parse({
      name: "Rules",
      members: [{ username: "marta", role: "member" }],
      tags: [{ name: "Blocked", color: "#b4321f" }],
      columns: [{ name: "Doing" }, { name: "Done" }],
      automations: [
        {
          name: "Done cleanup",
          trigger: "cardEntersColumn",
          column: "Done",
          actions: [
            { type: "completeChecklist" },
            { type: "removeTag", tag: "Blocked" },
            { type: "assign", users: ["marta", "ghost_user"] },
            { type: "fromTheFuture" },
          ],
        },
        { name: "Overdue", enabled: false, trigger: "deadlinePassed", actions: [{ type: "moveToColumn", column: "Doing" }] },
        { name: "Lost", trigger: "cardEntersColumn", column: "Nowhere", actions: [{ type: "completeChecklist" }] },
      ],
    });
    const [imported] = await importBoards([board], admin, originallyBy);
    const rules = await holder.db.automationRule.findMany({ where: { boardId: imported.boardId }, orderBy: { createdAt: "asc" } });
    expect(rules.map((r) => r.name)).toEqual(["Done cleanup", "Overdue"]);

    const exported = await exportBoard(imported.boardId);
    expect(exported!.boards[0].automations).toEqual([
      {
        name: "Done cleanup",
        enabled: true,
        trigger: "cardEntersColumn",
        column: "Done",
        actions: [{ type: "completeChecklist" }, { type: "removeTag", tag: "Blocked" }, { type: "assign", users: ["marta"] }],
      },
      { name: "Overdue", enabled: false, trigger: "deadlinePassed", column: null, actions: [{ type: "moveToColumn", column: "Doing" }] },
    ]);
    // Files from before automations existed still import.
    expect(exportBoardSchema.parse({ name: "Old", columns: [] }).automations).toEqual([]);
  });

  it("exports cards as CSV that the CSV import reads back", async () => {
    const board = await holder.db.board.findFirstOrThrow({ where: { name: "Trello launch plan" } });
    const data = await exportBoard(board.id);
    const rows = parseCsv(boardCardsCsv(data!));
    expect(rows[0].slice(0, 7)).toEqual(["title", "description", "column", "priority", "deadline", "tags", "assignees"]);
    const plan = planCsvImport(rows.slice(1), guessMapping(rows[0]), { columns: [], tags: [], members: ["marta"] });
    expect(plan.errors).toEqual([]);
    expect(plan.cards.find((c) => c.title === "Design the landing page")).toMatchObject({
      column: "Ideas",
      deadline: "2026-12-01",
      tags: ["Design", "Urgent"],
      assignees: ["marta"],
    });
  });

  it("adds CSV rows to an existing board, creating columns and tags", async () => {
    const db = holder.db;
    const board = await db.board.create({
      data: {
        name: "CSV target",
        columns: { create: [{ name: "To do", position: 0 }] },
        members: { create: [{ userId: admin.id, role: "owner" }] },
      },
    });
    const rows = parseCsv("title,column,tags\nOne,To do,x\nTwo,Later,\"x, y\"\n");
    const plan = planCsvImport(rows.slice(1), guessMapping(rows[0]), { columns: ["To do"], tags: [], members: [] });
    const result = await writeCsvPlan(board.id, plan, admin);
    expect(result).toEqual({ cards: 2, newColumns: 1, newTags: 2 });
    const columns = await db.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: { position: "asc" },
      include: { cards: { include: { tags: { include: { tag: true } } } } },
    });
    expect(columns.map((c) => [c.name, c.cards.map((card) => card.title)])).toEqual([
      ["To do", ["One"]],
      ["Later", ["Two"]],
    ]);
    expect(columns[1].cards[0].tags.map((t) => t.tag.name).sort()).toEqual(["x", "y"]);
  });
});

describe("backup archive", () => {
  it("writes valid ustar headers", () => {
    const header = tarHeader("kanbun.db", 1234, new Date(0));
    expect(header.length).toBe(512);
    expect(header.subarray(257, 262).toString()).toBe("ustar");
    expect(parseInt(header.subarray(124, 135).toString(), 8)).toBe(1234);
    const stored = parseInt(header.subarray(148, 154).toString(), 8);
    const copy = Buffer.from(header);
    copy.fill(" ", 148, 156);
    expect(copy.reduce((sum, b) => sum + b, 0)).toBe(stored);
  });

  it("streams files and in-memory entries, padded to 512-byte blocks", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanbun-tar-"));
    try {
      const file = path.join(dir, "a.txt");
      writeFileSync(file, "hello world");
      const chunks: Buffer[] = [];
      for await (const chunk of tarStream([
        { name: "backup.json", data: Buffer.from("{}") },
        { name: "attachments/a.txt", file },
        { name: "missing", file: path.join(dir, "nope") },
      ])) {
        chunks.push(chunk);
      }
      const tar = Buffer.concat(chunks);
      expect(tar.length % 512).toBe(0);
      // Two entries of one data block each, plus the two end-of-archive blocks.
      expect(tar.length).toBe(512 * 6);
      expect(tar.subarray(512 * 2, 512 * 2 + 17).toString()).toBe("attachments/a.txt");
      expect(tar.subarray(512 * 3, 512 * 3 + 11).toString()).toBe("hello world");

      // The system tar reads it back, including a file spanning several blocks.
      writeFileSync(path.join(dir, "big.bin"), Buffer.alloc(70_000, 7));
      const big: Buffer[] = [];
      for await (const chunk of tarStream([{ name: "attachments/ab/big.bin", file: path.join(dir, "big.bin") }])) {
        big.push(chunk);
      }
      const archive = path.join(dir, "out.tar");
      writeFileSync(archive, Buffer.concat(big));
      expect(execFileSync("tar", ["-tvf", archive]).toString()).toMatch(/70000.*attachments\/ab\/big\.bin/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
