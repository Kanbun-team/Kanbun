import { describe, expect, it } from "vitest";
import { describeActivity, formatActivity, parseActivityData, relativeTime } from "@/lib/activity";

describe("formatActivity", () => {
  it("describes moves, renames and priority changes", () => {
    expect(formatActivity("moved", { from: "To do", to: "Review" }, "Marta", "en")).toBe(
      "Marta moved this card from To do to Review"
    );
    expect(formatActivity("renamed", { from: "Old", to: "New" }, "Marta", "en")).toBe(
      "Marta renamed this card from “Old” to “New”"
    );
    expect(formatActivity("priority", { from: "normal", to: "critical" }, "Ada", "en")).toBe(
      "Ada changed the priority from Normal to Critical"
    );
  });

  it("describes cards made from templates and schedules", () => {
    expect(formatActivity("createdFromTemplate", { column: "To do", template: "Bug report" }, "Ada", "en")).toBe(
      "Ada created this card in To do from the template Bug report"
    );
    expect(formatActivity("createdBySchedule", { column: "To do", template: "Weekly review" }, "Ada", "en")).toBe(
      "Created in To do by the repeating schedule for Weekly review, set up by Ada"
    );
  });

  it("formats set and cleared deadlines as calendar dates", () => {
    expect(formatActivity("deadline", { to: "2026-12-03T00:00:00.000Z" }, "Ada", "en")).toBe(
      "Ada set the deadline to 3 Dec 2026"
    );
    expect(formatActivity("deadline", { to: null }, "Ada", "en")).toBe("Ada cleared the deadline");
  });

  it("covers assignees, tags, blocks and subtasks", () => {
    expect(formatActivity("assigneeAdded", { name: "Julia" }, "Ada", "en")).toBe("Ada assigned Julia");
    expect(formatActivity("assigneeRemoved", { name: "Julia" }, "Ada", "en")).toBe("Ada unassigned Julia");
    expect(formatActivity("tagAdded", { name: "Bug" }, "Ada", "en")).toBe("Ada added the tag Bug");
    expect(formatActivity("tagRemoved", { name: "Bug" }, "Ada", "en")).toBe("Ada removed the tag Bug");
    expect(formatActivity("blocked", { title: "API" }, "Ada", "en")).toBe("Ada marked this card as blocked by API");
    expect(formatActivity("unblocked", { title: "API" }, "Ada", "en")).toBe("Ada removed the blocker API");
    expect(formatActivity("subtaskDone", { title: "QA" }, "Ada", "en")).toBe("Ada completed the subtask QA");
    expect(formatActivity("created", { column: "Backlog" }, "Ada", "en")).toBe("Ada created this card in Backlog");
  });

  it("translates, keeping the actor where the language puts it", () => {
    expect(formatActivity("moved", { from: "A", to: "B" }, "Marta", "pl")).toBe(
      "Marta: przeniesiono kartę z A do B"
    );
    expect(formatActivity("priority", { from: "low", to: "high" }, "Marta", "de")).toBe(
      "Marta hat die Priorität von Niedrig auf Hoch geändert"
    );
  });

  it("splits around the actor so the name can be styled", () => {
    expect(describeActivity("tagAdded", { name: "Bug" }, "en")).toEqual(["", " added the tag Bug"]);
  });

  it("keeps placeholders in user text literal", () => {
    expect(formatActivity("renamed", { from: "{actor}", to: "{to}" }, "Ada", "en")).toBe(
      "Ada renamed this card from “{actor}” to “{to}”"
    );
  });

  it("falls back for unknown types and missing data", () => {
    expect(formatActivity("somethingNew", {}, "Ada", "en")).toBe("Ada changed this card");
    expect(formatActivity("moved", {}, "Ada", "en")).toBe("Ada moved this card from  to ");
  });
});

describe("parseActivityData", () => {
  it("returns an object for valid JSON and {} otherwise", () => {
    expect(parseActivityData('{"from":"a"}')).toEqual({ from: "a" });
    expect(parseActivityData("not json")).toEqual({});
    expect(parseActivityData("[1,2]")).toEqual({});
    expect(parseActivityData("null")).toEqual({});
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it("uses the largest fitting unit", () => {
    expect(relativeTime(ago(10), now, "en")).toBe("Now");
    expect(relativeTime(ago(5 * 60), now, "en")).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 3600), now, "en")).toBe("3 hours ago");
    expect(relativeTime(ago(26 * 3600), now, "en")).toBe("Yesterday");
    expect(relativeTime(ago(15 * 86400), now, "en")).toBe("2 weeks ago");
  });

  it("is localized", () => {
    expect(relativeTime(ago(5 * 60), now, "pl")).toBe("5 minut temu");
  });
});
