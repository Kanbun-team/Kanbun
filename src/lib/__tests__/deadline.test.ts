import { describe, expect, it } from "vitest";
import { daysUntil, deadlineTone, relativeDeadline } from "@/lib/deadline";

const now = new Date(2026, 10, 17, 15, 30); // 17 Nov 2026, afternoon, local time

describe("deadlines", () => {
  it("counts calendar days, not 24h periods", () => {
    expect(daysUntil("2026-11-17T00:00:00.000Z", now)).toBe(0);
    expect(daysUntil("2026-11-18T00:00:00.000Z", now)).toBe(1);
    expect(daysUntil("2026-11-15T00:00:00.000Z", now)).toBe(-2);
  });

  it("marks late, soon and normal", () => {
    expect(deadlineTone(-1)).toBe("late");
    expect(deadlineTone(0)).toBe("soon");
    expect(deadlineTone(1)).toBe("soon");
    expect(deadlineTone(2)).toBe("normal");
  });

  it("formats relative labels per locale", () => {
    expect(relativeDeadline("2026-11-18T00:00:00.000Z", "en", now).label).toBe("Tomorrow");
    expect(relativeDeadline("2026-11-20T00:00:00.000Z", "en", now).label).toBe("In 3 days");
    expect(relativeDeadline("2026-11-15T00:00:00.000Z", "en", now).label).toBe("2 days ago");
    expect(relativeDeadline("2026-11-18T00:00:00.000Z", "pl", now).label).toBe("Jutro");
  });
});
