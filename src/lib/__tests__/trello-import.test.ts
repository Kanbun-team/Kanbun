import { describe, expect, it } from "vitest";
import fixture from "./fixtures/trello-board.json";
import { mapTrelloBoard, trelloColor, TrelloFormatError } from "@/lib/transfer/trello";
import { exportBoardSchema } from "@/lib/transfer/format";
import { PALETTE } from "@/lib/palette";

const originallyBy = (name: string, date: string) => `Originally by ${name} on ${date}`;

describe("mapTrelloBoard", () => {
  const { board, stats, memberUsernames } = mapTrelloBoard(fixture, { originallyBy });

  it("maps open lists to columns in position order and skips closed ones", () => {
    expect(board.name).toBe("Trello launch plan");
    expect(board.columns.map((c) => c.name)).toEqual(["Ideas", "Doing"]);
    expect(stats).toMatchObject({ lists: 2, skippedLists: 1, cards: 3, skippedCards: 2 });
  });

  it("orders cards by position and keeps name, description and due date", () => {
    const ideas = board.columns[0].cards!;
    expect(ideas.map((c) => c.title)).toEqual(["Write the brief", "Design the landing page"]);
    const landing = ideas[1];
    expect(landing.description).toBe("Hero, pricing and **FAQ**.");
    expect(landing.deadline).toBe("2026-12-01");
    expect(landing.coverColor).toBe("#ea580c");
  });

  it("maps labels to tags with palette colors, naming unnamed labels after their color", () => {
    expect(board.tags).toEqual([
      { name: "Design", color: "#7c3aed" },
      { name: "Urgent", color: "#dc2626" },
      { name: "sky", color: "#0891b2" },
    ]);
    expect(board.columns[0].cards![1].tags).toEqual(["Design", "Urgent"]);
    expect(board.columns[0].cards![0].tags).toEqual(["sky"]);
    for (const tag of board.tags!) expect(PALETTE).toContain(tag.color);
  });

  it("merges checklists in order, prefixed with their name when there are several", () => {
    expect(board.columns[0].cards![1].checklist).toEqual([
      { title: "Build: Wireframe", done: true },
      { title: "Build: Mobile layout", done: false },
      { title: "Review: Copy review", done: false },
    ]);
    expect(stats.checklistItems).toBe(3);
  });

  it("turns commentCard actions into comments, oldest first, with the original author", () => {
    const build = board.columns[1].cards![0];
    expect(build.comments!.map((c) => c.body)).toEqual([
      "Originally by Marta Nowak on 2026-10-01\n\nFirst comment",
      "Originally by Ghost User on 2026-10-02\n\nSecond comment",
    ]);
    expect(build.comments!.every((c) => c.author === null)).toBe(true);
    expect(stats.comments).toBe(2);
  });

  it("lists card members by username for matching", () => {
    expect(board.columns[0].cards![1].assignees).toEqual(["marta", "ghost_user"]);
    expect(memberUsernames.sort()).toEqual(["ghost_user", "marta"]);
  });

  it("produces a valid Kanbun board", () => {
    expect(exportBoardSchema.safeParse(board).success).toBe(true);
  });

  it("rejects files that are not Trello exports", () => {
    expect(() => mapTrelloBoard({ hello: "world" }, { originallyBy })).toThrow(TrelloFormatError);
    expect(() => mapTrelloBoard([], { originallyBy })).toThrow(TrelloFormatError);
  });
});

describe("trelloColor", () => {
  it("maps base and shaded Trello colors to the palette", () => {
    expect(trelloColor("green")).toBe("#16a34a");
    expect(trelloColor("green_light")).toBe("#16a34a");
    expect(trelloColor("yellow")).toBe("#d97706");
    expect(trelloColor("black_dark")).toBe("#475569");
    expect(trelloColor(null)).toBe(PALETTE[9]);
    expect(trelloColor("unknown-color")).toBe(PALETTE[9]);
  });
});
