import { describe, expect, it } from "vitest";
import { parseMentions } from "@/lib/notifications";

describe("parseMentions", () => {
  it("finds unique, lowercased usernames", () => {
    expect(parseMentions("@Alice and @bob, also @alice")).toEqual(["alice", "bob"]);
  });

  it("allows dots, dashes and underscores inside names", () => {
    expect(parseMentions("ping @jan.kowalski-2_x")).toEqual(["jan.kowalski-2_x"]);
  });

  it("ignores trailing sentence punctuation", () => {
    expect(parseMentions("Thanks @bob.")).toEqual(["bob"]);
    expect(parseMentions("Ask @bob... or @ann-")).toEqual(["bob", "ann"]);
  });

  it("does not treat email addresses as mentions", () => {
    expect(parseMentions("mail me at jan@example.com")).toEqual([]);
  });
});
