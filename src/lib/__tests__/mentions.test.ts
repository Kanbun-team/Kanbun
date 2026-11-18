import { describe, expect, it } from "vitest";
import { activeMention, filterMentionCandidates, insertMention } from "@/lib/mentions";
import { renderMarkdownToHtml as md } from "@/lib/markdown";

const people = [
  { id: "1", username: "marta", displayName: "Marta Nowak", avatarUrl: null },
  { id: "2", username: "tomek", displayName: "Tomek Wiśniewski", avatarUrl: null },
  { id: "3", username: "admin", displayName: "Ada Admin", avatarUrl: null },
  { id: "4", username: "jmarks", displayName: null, avatarUrl: null },
];

describe("activeMention", () => {
  it("finds the mention being typed at the caret", () => {
    expect(activeMention("Hi @ma", 6)).toEqual({ start: 3, query: "ma" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("line\n@to", 8)).toEqual({ start: 5, query: "to" });
  });

  it("ignores emails, finished mentions and text after the caret", () => {
    expect(activeMention("jan@example", 11)).toBeNull();
    expect(activeMention("@marta done", 11)).toBeNull();
    expect(activeMention("Hi @ma", 2)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the typed query and adds a space", () => {
    expect(insertMention("Hi @ma", 3, 6, "marta")).toEqual({ text: "Hi @marta ", caret: 10 });
  });

  it("swallows the rest of a half-typed name and keeps one space", () => {
    expect(insertMention("@ma rest", 0, 3, "marta")).toEqual({ text: "@marta rest", caret: 7 });
    expect(insertMention("@mart!", 0, 2, "marta")).toEqual({ text: "@marta !", caret: 7 });
  });
});

describe("filterMentionCandidates", () => {
  it("ranks username prefixes before display name words before substrings", () => {
    expect(filterMentionCandidates(people, "ma").map((p) => p.username)).toEqual(["marta", "jmarks"]);
    expect(filterMentionCandidates(people, "ad").map((p) => p.username)).toEqual(["admin"]);
    expect(filterMentionCandidates(people, "now").map((p) => p.username)).toEqual(["marta"]);
  });

  it("ignores case and accents and respects the limit", () => {
    expect(filterMentionCandidates(people, "WIS").map((p) => p.username)).toEqual(["tomek"]);
    expect(filterMentionCandidates(people, "", 2)).toHaveLength(2);
  });
});

describe("mention highlighting in markdown", () => {
  const known = { mentions: ["marta", "Tomek"] };

  it("links known usernames to their profile", () => {
    const html = md("Thanks @marta.", known);
    expect(html).toMatch(/<a href="\/users\/marta" class="mention[^"]*">@marta<\/a>\.<\/p>$/);
  });

  it("matches usernames case-insensitively", () => {
    expect(md("cc @TOMEK", known)).toContain('href="/users/tomek"');
  });

  it("leaves unknown names, emails and code alone", () => {
    expect(md("@nobody", known)).toBe("<p>@nobody</p>");
    expect(md("mail marta@example.com", known)).not.toContain("<a ");
    expect(md("`@marta`", known)).not.toContain('class="mention');
  });

  it("is off unless usernames are given", () => {
    expect(md("@marta")).toBe("<p>@marta</p>");
  });

  it("keeps underscores in usernames out of emphasis", () => {
    const html = md("@a_b_c and _x_", { mentions: ["a_b_c"] });
    expect(html).toContain(">@a_b_c</a>");
    expect(html).toContain("<em>x</em>");
  });

  it("cannot inject markup next to a mention", () => {
    const html = md('<b>@marta</b>"><img src=x>', known);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<img");
    expect(html).toContain(">@marta</a>&lt;/b&gt;");
  });

  it("does not highlight inside link text or urls", () => {
    const html = md("[ask @marta](https://e.com/@marta)", known);
    expect(html).not.toContain('class="mention');
  });
});
