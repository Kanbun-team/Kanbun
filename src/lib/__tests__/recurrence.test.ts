import { describe, expect, it } from "vitest";
import { describeRule, nextOccurrence, toRule, type RecurrenceRule } from "@/lib/recurrence";

// Dates are built with the local-time constructor, so the expectations hold
// in any time zone the tests run in.
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

describe("nextOccurrence", () => {
  it("daily: later today, otherwise tomorrow", () => {
    const rule: RecurrenceRule = { rule: "daily", timeOfDay: "09:00" };
    expect(nextOccurrence(rule, at(2026, 11, 18, 8, 0))).toEqual(at(2026, 11, 18, 9, 0));
    expect(nextOccurrence(rule, at(2026, 11, 18, 9, 0))).toEqual(at(2026, 11, 19, 9, 0));
    expect(nextOccurrence(rule, at(2026, 12, 31, 10, 0))).toEqual(at(2027, 1, 1, 9, 0));
  });

  it("daily without a time runs at midnight", () => {
    expect(nextOccurrence({ rule: "daily", timeOfDay: null }, at(2026, 11, 18, 15, 30))).toEqual(at(2026, 11, 19));
  });

  it("weekly: the next matching weekday", () => {
    // 2026-11-18 is a Wednesday.
    const monday: RecurrenceRule = { rule: "weekly", weekday: 1, timeOfDay: null };
    expect(nextOccurrence(monday, at(2026, 11, 18, 12))).toEqual(at(2026, 11, 23));
    const wednesday: RecurrenceRule = { rule: "weekly", weekday: 3, timeOfDay: "17:00" };
    expect(nextOccurrence(wednesday, at(2026, 11, 18, 12))).toEqual(at(2026, 11, 18, 17));
    expect(nextOccurrence(wednesday, at(2026, 11, 18, 17))).toEqual(at(2026, 11, 25, 17));
    const sunday: RecurrenceRule = { rule: "weekly", weekday: 0, timeOfDay: null };
    expect(nextOccurrence(sunday, at(2026, 12, 28))).toEqual(at(2027, 1, 3));
  });

  it("monthly: the given day, this month or next", () => {
    const first: RecurrenceRule = { rule: "monthly", monthDay: 1, timeOfDay: null };
    expect(nextOccurrence(first, at(2026, 11, 18))).toEqual(at(2026, 12, 1));
    expect(nextOccurrence(first, at(2026, 12, 5))).toEqual(at(2027, 1, 1));
    const fifteenth: RecurrenceRule = { rule: "monthly", monthDay: 15, timeOfDay: "08:30" };
    expect(nextOccurrence(fifteenth, at(2026, 11, 15, 8, 0))).toEqual(at(2026, 11, 15, 8, 30));
  });

  it("monthly: a day the month lacks means its last day", () => {
    const last: RecurrenceRule = { rule: "monthly", monthDay: 31, timeOfDay: null };
    expect(nextOccurrence(last, at(2026, 11, 2))).toEqual(at(2026, 11, 30));
    expect(nextOccurrence(last, at(2026, 11, 30))).toEqual(at(2026, 12, 31));
    expect(nextOccurrence(last, at(2027, 1, 31))).toEqual(at(2027, 2, 28));
    expect(nextOccurrence(last, at(2028, 1, 31))).toEqual(at(2028, 2, 29));
    const thirtieth: RecurrenceRule = { rule: "monthly", monthDay: 30, timeOfDay: null };
    expect(nextOccurrence(thirtieth, at(2027, 2, 1))).toEqual(at(2027, 2, 28));
    expect(nextOccurrence(thirtieth, at(2027, 2, 28))).toEqual(at(2027, 3, 30));
  });

  it("is always strictly in the future and advances on repeat", () => {
    const rules: RecurrenceRule[] = [
      { rule: "daily", timeOfDay: "23:59" },
      { rule: "weekly", weekday: 5, timeOfDay: "06:00" },
      { rule: "monthly", monthDay: 29, timeOfDay: null },
    ];
    for (const rule of rules) {
      let t = at(2026, 1, 1);
      for (let i = 0; i < 40; i++) {
        const next = nextOccurrence(rule, t);
        expect(next.getTime()).toBeGreaterThan(t.getTime());
        t = next;
      }
    }
  });
});

describe("toRule", () => {
  it("validates the fields each rule needs", () => {
    expect(toRule({ rule: "weekly", weekday: 1 })).toEqual({ rule: "weekly", weekday: 1, timeOfDay: null });
    expect(toRule({ rule: "weekly", weekday: 7 })).toBeNull();
    expect(toRule({ rule: "weekly" })).toBeNull();
    expect(toRule({ rule: "monthly", monthDay: 0 })).toBeNull();
    expect(toRule({ rule: "monthly", monthDay: 31, timeOfDay: "09:05" })).toEqual({
      rule: "monthly",
      monthDay: 31,
      timeOfDay: "09:05",
    });
    expect(toRule({ rule: "daily", timeOfDay: "25:00" })).toBeNull();
    expect(toRule({ rule: "hourly" })).toBeNull();
  });
});

describe("describeRule", () => {
  it("reads the rule back in words", () => {
    expect(describeRule({ rule: "weekly", weekday: 1, timeOfDay: null }, "en")).toBe("Every Monday");
    expect(describeRule({ rule: "monthly", monthDay: 1, timeOfDay: null }, "en")).toBe("Monthly on the 1st");
    expect(describeRule({ rule: "monthly", monthDay: 22, timeOfDay: null }, "en")).toBe("Monthly on the 22nd");
    expect(describeRule({ rule: "monthly", monthDay: 13, timeOfDay: null }, "en")).toBe("Monthly on the 13th");
    expect(describeRule({ rule: "daily", timeOfDay: "09:00" }, "en")).toBe("Every day at 09:00");
    expect(describeRule({ rule: "weekly", weekday: 1, timeOfDay: null }, "de")).toBe("Jeden Montag");
  });
});
