import { describe, expect, it } from "vitest";
import {
  DAY,
  HOUR,
  USUAL_MIN_MS,
  buildTimelines,
  columnResolver,
  computeInsights,
  formatDuration,
  percentile,
  staleDays,
  toFlowEvent,
  usualTimes,
  weekStart,
  type FlowColumn,
  type FlowEvent,
} from "@/lib/flow";

// Wednesday 2026-11-18 12:00 UTC.
const NOW = Date.UTC(2026, 10, 18, 12);
const ago = (days: number) => NOW - days * DAY;

const COLS: FlowColumn[] = [
  { id: "backlog", name: "Backlog" },
  { id: "doing", name: "Doing" },
  { id: "review", name: "Review" },
  { id: "done", name: "Done" },
];

const created = (cardId: string, at: number, column: string): FlowEvent => ({
  cardId,
  at,
  created: true,
  from: null,
  to: { id: column, name: null },
});
const moved = (cardId: string, at: number, from: string, to: string): FlowEvent => ({
  cardId,
  at,
  created: false,
  from: { id: from, name: null },
  to: { id: to, name: null },
});

function insights(cards: { id: string; columnId: string; createdAt: number }[], events: FlowEvent[], columns = COLS, flowDays = 30) {
  return computeInsights({ columns, cards, events, now: NOW, flowDays });
}

describe("percentile", () => {
  it("interpolates between ranks and handles small inputs", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.85)).toBe(7);
    expect(percentile([1, 3], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.85)).toBeCloseTo(85);
  });
});

describe("weekStart", () => {
  it("is Monday 00:00 UTC", () => {
    expect(new Date(weekStart(NOW)).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(new Date(weekStart(Date.UTC(2026, 10, 16))).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(new Date(weekStart(Date.UTC(2026, 10, 22, 23, 59))).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});

describe("toFlowEvent", () => {
  it("reads created and moved entries, ids optional", () => {
    expect(toFlowEvent({ cardId: "a", type: "created", data: '{"column":"Backlog"}', createdAt: 5 })).toEqual({
      cardId: "a",
      at: 5,
      created: true,
      from: null,
      to: { id: null, name: "Backlog" },
    });
    expect(
      toFlowEvent({ cardId: "a", type: "moved", data: '{"from":"A","to":"B","fromId":"x","toId":"y"}', createdAt: new Date(9) })
    ).toEqual({ cardId: "a", at: 9, created: false, from: { id: "x", name: "A" }, to: { id: "y", name: "B" } });
    expect(toFlowEvent({ cardId: "a", type: "createdFromTemplate", data: '{"column":"X","template":"T"}', createdAt: 1 })?.created).toBe(true);
  });

  it("ignores other types and broken data", () => {
    expect(toFlowEvent({ cardId: "a", type: "renamed", data: "{}", createdAt: 1 })).toBeNull();
    expect(toFlowEvent({ cardId: "a", type: "moved", data: "not json", createdAt: 1 })).toBeNull();
    expect(toFlowEvent({ cardId: "a", type: "moved", data: "[1]", createdAt: 1 })).toBeNull();
  });
});

describe("columnResolver", () => {
  const resolve = columnResolver([...COLS, { id: "doing2", name: "Doing" }]);
  it("prefers the id, falls back to the first column with the name", () => {
    expect(resolve({ id: "review", name: "Doing" })).toBe("review");
    expect(resolve({ id: "gone", name: "Doing" })).toBe("doing");
    expect(resolve({ id: null, name: "Doing" })).toBe("doing");
  });
  it("gives null for deleted or renamed columns", () => {
    expect(resolve({ id: "gone", name: "Old name" })).toBeNull();
    expect(resolve(null)).toBeNull();
  });
});

describe("timelines", () => {
  it("keeps the current column even when the last entry names an old column", () => {
    const [tl] = buildTimelines(COLS, [{ id: "a", columnId: "review", createdAt: ago(10) }], [
      created("a", ago(10), "backlog"),
      { cardId: "a", at: ago(5), created: false, from: { id: null, name: "Backlog" }, to: { id: null, name: "Old name" } },
    ]);
    expect(tl.stays.map((s) => s.columnId)).toEqual(["backlog", "review"]);
    expect(tl.complete).toBe(true);
  });

  it("starts a history that begins with a move in the move's column, as incomplete", () => {
    const [tl] = buildTimelines(COLS, [{ id: "a", columnId: "review", createdAt: ago(10) }], [moved("a", ago(4), "doing", "review")]);
    expect(tl.stays).toEqual([
      { columnId: "doing", start: ago(10), end: ago(4) },
      { columnId: "review", start: ago(4), end: null },
    ]);
    expect(tl.complete).toBe(false);
    expect(tl.known).toBe(true);
  });

  it("puts a card without history in its column since creation, unknown", () => {
    const [tl] = buildTimelines(COLS, [{ id: "a", columnId: "doing", createdAt: ago(3) }], []);
    expect(tl.stays).toEqual([{ columnId: "doing", start: ago(3), end: null }]);
    expect(tl.known).toBe(false);
  });
});

describe("computeInsights", () => {
  it("handles an empty board", () => {
    const r = insights([], []);
    expect(r.cycle.samples).toEqual([]);
    expect(r.cycle.median).toBeNull();
    expect(r.cycle.p85).toBeNull();
    expect(r.throughput).toHaveLength(12);
    expect(r.throughput.every((w) => w.count === 0)).toBe(true);
    expect(r.flow).toHaveLength(30);
    expect(r.flow.every((d) => d.counts.every((n) => n === 0))).toBe(true);
    expect(r.aging).toEqual([]);
    expect(r.historyStart).toBeNull();
    expect(r.totalCards).toBe(0);
  });

  it("has no done column or work columns with a single column", () => {
    const r = insights([{ id: "a", columnId: "only", createdAt: ago(2) }], [created("a", ago(2), "only")], [{ id: "only", name: "Only" }]);
    expect(r.doneColumnId).toBeNull();
    expect(r.workColumnIds).toEqual([]);
    expect(r.throughput.every((w) => w.count === 0)).toBe(true);
  });

  it("measures cycle time from the first work column to the last entry into Done", () => {
    const r = insights(
      [{ id: "a", columnId: "done", createdAt: ago(20) }],
      [created("a", ago(20), "backlog"), moved("a", ago(10), "backlog", "doing"), moved("a", ago(4), "doing", "done")]
    );
    expect(r.cycle.samples).toEqual([{ cardId: "a", ms: 6 * DAY }]);
    expect(r.cycle.median).toBe(6 * DAY);
    expect(r.cycle.skipped).toBe(0);
    expect(r.throughput.reduce((s, w) => s + w.count, 0)).toBe(1);
  });

  it("counts a card moved back from review, and reopened from Done, from its first start to its last finish", () => {
    const r = insights(
      [{ id: "a", columnId: "done", createdAt: ago(30) }],
      [
        created("a", ago(30), "backlog"),
        moved("a", ago(20), "backlog", "doing"),
        moved("a", ago(15), "doing", "review"),
        moved("a", ago(14), "review", "doing"),
        moved("a", ago(10), "doing", "review"),
        moved("a", ago(9), "review", "done"),
        moved("a", ago(8), "done", "review"),
        moved("a", ago(2), "review", "done"),
      ]
    );
    expect(r.cycle.samples).toEqual([{ cardId: "a", ms: 18 * DAY }]);
    // Finished once, in the week of its last move to Done.
    expect(r.throughput.reduce((s, w) => s + w.count, 0)).toBe(1);
    expect(r.throughput[11].count).toBe(1);
    // Both stays in Doing count toward the usual time (but 2 < 5 samples).
    expect(r.usual.get("doing")?.samples).toBe(2);
    expect(r.usual.get("doing")?.p85).toBeNull();
  });

  it("does not count a card moved back out of Done", () => {
    const r = insights(
      [{ id: "a", columnId: "review", createdAt: ago(10) }],
      [created("a", ago(10), "doing"), moved("a", ago(5), "doing", "done"), moved("a", ago(1), "done", "review")]
    );
    expect(r.cycle.samples).toEqual([]);
    expect(r.throughput.every((w) => w.count === 0)).toBe(true);
    expect(r.aging.map((a) => a.cardId)).toEqual(["a"]);
  });

  it("counts cards created in Done or moved straight to Done as finished, without a cycle time", () => {
    const r = insights(
      [
        { id: "a", columnId: "done", createdAt: ago(3) },
        { id: "b", columnId: "done", createdAt: ago(6) },
      ],
      [created("a", ago(3), "done"), created("b", ago(6), "backlog"), moved("b", ago(5), "backlog", "done")]
    );
    expect(r.cycle.samples).toEqual([]);
    expect(r.cycle.skipped).toBe(2);
    expect(r.throughput.reduce((s, w) => s + w.count, 0)).toBe(2);
  });

  it("measures from creation on a board with two columns", () => {
    const two = [COLS[0], COLS[3]];
    const r = insights(
      [{ id: "a", columnId: "done", createdAt: ago(5) }],
      [created("a", ago(5), "backlog"), moved("a", ago(2), "backlog", "done")],
      two
    );
    expect(r.workColumnIds).toEqual(["backlog"]);
    expect(r.cycle.samples).toEqual([{ cardId: "a", ms: 3 * DAY }]);
  });

  it("leaves cards finished before the 12 weeks out", () => {
    const r = insights(
      [{ id: "a", columnId: "done", createdAt: ago(200) }],
      [created("a", ago(200), "doing"), moved("a", ago(100), "doing", "done")]
    );
    expect(r.cycle.samples).toEqual([]);
    expect(r.throughput.every((w) => w.count === 0)).toBe(true);
  });

  it("puts cycle times in buckets", () => {
    const cards = [0.5, 1.5, 3, 7, 15, 40].map((d, i) => ({ id: `c${i}`, columnId: "done", createdAt: ago(60) }));
    const events = [0.5, 1.5, 3, 7, 15, 40].flatMap((d, i) => [
      created(`c${i}`, ago(1 + d), "doing"),
      moved(`c${i}`, ago(1), "doing", "done"),
    ]);
    const r = insights(cards, events);
    expect(r.cycle.buckets).toEqual([1, 1, 1, 1, 1, 1]);
    expect(r.cycle.median).toBe(5 * DAY);
  });

  it("counts cards per column at the end of each day", () => {
    const r = insights(
      [{ id: "a", columnId: "doing", createdAt: ago(3) }],
      [created("a", Date.UTC(2026, 10, 15, 10), "backlog"), moved("a", Date.UTC(2026, 10, 17, 9), "backlog", "doing")],
      COLS,
      5
    );
    expect(r.flow.map((d) => new Date(d.day).toISOString().slice(0, 10))).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]);
    expect(r.flow.map((d) => d.counts)).toEqual([
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ]);
  });

  it("reports where history begins and how many cards lack their start", () => {
    const r = insights(
      [
        { id: "a", columnId: "doing", createdAt: ago(9) },
        { id: "b", columnId: "doing", createdAt: ago(50) },
      ],
      [created("a", ago(9), "backlog"), moved("a", ago(8), "backlog", "doing")]
    );
    expect(r.historyStart).toBe(ago(9));
    expect(r.partialCards).toBe(1);
  });

  it("lists aging work oldest first and only flags cards with a known start", () => {
    // Five cards left Doing after a day: the usual time is the minimum, 3 days.
    const cards = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, columnId: "done", createdAt: ago(30) })),
      { id: "old", columnId: "doing", createdAt: ago(30) },
      { id: "new", columnId: "doing", createdAt: ago(2) },
      { id: "unknown", columnId: "doing", createdAt: ago(40) },
    ];
    const events = [
      ...Array.from({ length: 5 }, (_, i) => [created(`d${i}`, ago(20), "doing"), moved(`d${i}`, ago(19), "doing", "done")]).flat(),
      created("old", ago(30), "backlog"),
      moved("old", ago(10), "backlog", "doing"),
      created("new", ago(2), "doing"),
    ];
    const r = insights(cards, events);
    expect(r.usual.get("doing")?.threshold).toBe(USUAL_MIN_MS);
    expect(r.aging.map((a) => [a.cardId, a.over])).toEqual([
      ["unknown", false],
      ["old", true],
      ["new", false],
    ]);
  });
});

describe("usual time and stale days", () => {
  it("needs five stays and uses the 85th percentile above the minimum", () => {
    const stays = [4, 5, 6, 7, 20];
    const cards = stays.map((_, i) => ({ id: `c${i}`, columnId: "review", createdAt: ago(60) }));
    const events = stays.flatMap((d, i) => [created(`c${i}`, ago(40 + d), "doing"), moved(`c${i}`, ago(40), "doing", "review")]);
    const tl = buildTimelines(COLS, cards, events);
    const usual = usualTimes(COLS, tl, NOW);
    expect(usual.get("doing")?.samples).toBe(5);
    expect(usual.get("doing")?.p85).toBeCloseTo(percentile([4, 5, 6, 7, 20].map((d) => d * DAY), 0.85)!);
    expect(usual.get("review")?.threshold).toBeNull();
    // Only work columns have a usual time.
    expect(usual.has("backlog")).toBe(false);
    expect(usual.has("done")).toBe(false);

    const doing = usual.get("doing")!;
    expect(staleDays(ago(5), doing, NOW)).toBeNull();
    expect(staleDays(ago(30), doing, NOW)).toBe(30);
    expect(staleDays(null, doing, NOW)).toBeNull();
    expect(staleDays(ago(30), usual.get("review"), NOW)).toBeNull();
  });

  it("ignores stays that ended long ago and quick corrections", () => {
    const cards = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, columnId: "review", createdAt: ago(300) }));
    const events = cards.flatMap((c, i) => [
      created(c.id, i < 5 ? ago(200) : ago(2), "doing"),
      moved(c.id, i < 5 ? ago(150) : ago(2) + 1000, "doing", "review"),
    ]);
    const usual = usualTimes(COLS, buildTimelines(COLS, cards, events), NOW);
    expect(usual.get("doing")?.samples).toBe(0);
  });
});

describe("formatDuration", () => {
  it("uses hours under a day and whole days after", () => {
    expect(formatDuration(10 * 60 * 1000, "en")).toBe("Under 1 hour");
    expect(formatDuration(5 * HOUR, "en")).toBe("5 hours");
    expect(formatDuration(DAY, "en")).toBe("1 day");
    expect(formatDuration(3.4 * DAY, "en")).toBe("3 days");
    expect(formatDuration(5 * DAY, "pl")).toBe("5 dni");
  });
});
