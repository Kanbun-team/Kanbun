import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  isDueSoon,
  notificationText,
  parsePrefs,
  planDeliveries,
  serializePrefs,
  type NotificationPrefs,
} from "@/lib/notification-prefs";

const defaults = parsePrefs(null);
const withPrefs = (p: Partial<NotificationPrefs>): NotificationPrefs => ({ ...defaults, ...p });

describe("parsePrefs / serializePrefs", () => {
  it("defaults every type to in-app", () => {
    for (const type of NOTIFICATION_TYPES) expect(defaults[type]).toBe("inapp");
  });

  it("ignores bad JSON, unknown types and unknown channels", () => {
    expect(parsePrefs("not json")).toEqual(defaults);
    expect(parsePrefs("[1,2]")).toEqual(defaults);
    const p = parsePrefs(JSON.stringify({ comment: "email", moved: "loud", bogus: "none" }));
    expect(p.comment).toBe("email");
    expect(p.moved).toBe("inapp");
    expect(p).not.toHaveProperty("bogus");
  });

  it("stores only non-default choices and round-trips", () => {
    const raw = serializePrefs({ comment: "none", mention: "email", assigned: "inapp", junk: "email", moved: 3 });
    expect(JSON.parse(raw)).toEqual({ comment: "none", mention: "email" });
    expect(parsePrefs(raw)).toEqual(withPrefs({ comment: "none", mention: "email" }));
  });
});

describe("planDeliveries", () => {
  const prefs = new Map<string, NotificationPrefs>();
  const lookup = (id: string) => prefs.get(id);

  it("never notifies the actor", () => {
    expect(planDeliveries([{ userId: "a", type: "comment" }], "a", lookup)).toEqual([]);
  });

  it("gives one notification per person, the most specific type winning", () => {
    const out = planDeliveries(
      [
        { userId: "u1", type: "comment" },
        { userId: "u1", type: "mention" },
        { userId: "u2", type: "comment" },
        { userId: "u2", type: "comment" },
      ],
      "actor",
      lookup
    );
    expect(out).toEqual([
      { userId: "u1", type: "mention", email: false },
      { userId: "u2", type: "comment", email: false },
    ]);
  });

  it("prefers assigned over watching paths", () => {
    const out = planDeliveries(
      [
        { userId: "u1", type: "moved" },
        { userId: "u1", type: "assigned" },
      ],
      null,
      lookup
    );
    expect(out).toEqual([{ userId: "u1", type: "assigned", email: false }]);
  });

  it("falls back to the next type when the preferred one is off", () => {
    prefs.set("muted", withPrefs({ mention: "none" }));
    const out = planDeliveries(
      [
        { userId: "muted", type: "mention" },
        { userId: "muted", type: "comment" },
      ],
      "actor",
      lookup
    );
    expect(out).toEqual([{ userId: "muted", type: "comment", email: false }]);
  });

  it("drops a person who switched off every type they qualify for", () => {
    prefs.set("quiet", withPrefs({ comment: "none" }));
    expect(planDeliveries([{ userId: "quiet", type: "comment" }], "actor", lookup)).toEqual([]);
  });

  it("flags email for types set to in-app + email", () => {
    prefs.set("mailer", withPrefs({ dueSoon: "email" }));
    expect(planDeliveries([{ userId: "mailer", type: "dueSoon" }], null, lookup)).toEqual([
      { userId: "mailer", type: "dueSoon", email: true },
    ]);
  });

  it("uses defaults for people without stored preferences", () => {
    expect(planDeliveries([{ userId: "nobody", type: "newCard" }], "actor", () => undefined)).toEqual([
      { userId: "nobody", type: "newCard", email: false },
    ]);
  });
});

describe("isDueSoon", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const now = new Date("2026-11-18T10:00:00.000Z");

  it("is true for today and tomorrow", () => {
    expect(isDueSoon(day("2026-11-18"), now)).toBe(true);
    expect(isDueSoon(day("2026-11-19"), now)).toBe(true);
  });

  it("is false once the deadline day is over, or two days ahead", () => {
    expect(isDueSoon(day("2026-11-17"), now)).toBe(false);
    expect(isDueSoon(day("2026-11-20"), now)).toBe(false);
  });
});

describe("notificationText", () => {
  it("renders every type with actor and card", () => {
    const base = { actorName: "Ada", cardTitle: "Fix login" };
    expect(notificationText({ ...base, type: "comment" }, "en")).toBe('Ada commented on "Fix login"');
    expect(notificationText({ ...base, type: "newCard" }, "en")).toBe('Ada added "Fix login"');
    expect(notificationText({ ...base, type: "moved" }, "en")).toContain("Ada moved");
    expect(notificationText({ actorName: null, cardTitle: "Fix login", type: "dueSoon" }, "en")).toBe(
      'Deadline approaching: "Fix login"'
    );
    expect(notificationText({ ...base, type: "mention" }, "de")).toContain("Ada");
  });
});
