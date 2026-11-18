import { describe, expect, it } from "vitest";
import {
  MARK_END,
  MARK_START,
  buildFtsQuery,
  foldText,
  matchesTerms,
  parseSnippet,
  searchTerms,
} from "@/lib/search-query";

describe("searchTerms", () => {
  it("splits on anything that is not a letter or digit and lowercases", () => {
    expect(searchTerms("  Responsive  NAV-bar v2 ")).toEqual(["responsive", "nav", "bar", "v2"]);
  });

  it("keeps letters with diacritics", () => {
    expect(searchTerms("Źródło gęśli")).toEqual(["źródło", "gęśli"]);
  });

  it("drops duplicates and caps the number of terms", () => {
    expect(searchTerms("a a A b")).toEqual(["a", "b"]);
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
  });

  it("returns nothing for punctuation only", () => {
    expect(searchTerms(`"*()-:^+`)).toEqual([]);
  });
});

describe("buildFtsQuery", () => {
  it("quotes every term and matches it as a prefix", () => {
    expect(buildFtsQuery("responsive nav")).toBe('"responsive"* "nav"*');
  });

  it("returns null when there is nothing to search for", () => {
    expect(buildFtsQuery("")).toBeNull();
    expect(buildFtsQuery("   ")).toBeNull();
    expect(buildFtsQuery('"" * ()')).toBeNull();
  });

  it("never lets FTS5 syntax through", () => {
    const query = buildFtsQuery('title:foo OR bar* NEAR("x" "y") -baz ^qux "unterminated');
    expect(query).toBe('"title"* "foo"* "or"* "bar"* "near"* "x"* "y"* "baz"*');
    // Only quoted terms, each followed by a star, separated by spaces.
    expect(query).toMatch(/^("[\p{L}\p{N}]+"\* ?)+$/u);
  });

  it("lowercases operators so they become plain words", () => {
    expect(buildFtsQuery("AND NOT")).toBe('"and"* "not"*');
  });

  it("ignores input past the length limit", () => {
    const long = "word ".repeat(100) + "tail";
    expect(buildFtsQuery(long)).toBe('"word"*');
  });
});

describe("foldText and matchesTerms", () => {
  it("removes diacritics, including the Polish ł", () => {
    expect(foldText("Zażółć gęślą jaźń")).toBe("zazolc gesla jazn");
    expect(foldText("Łódź")).toBe("lodz");
  });

  it("matches every term as a word prefix", () => {
    expect(matchesTerms("Website relaunch", ["web", "rel"])).toBe(true);
    expect(matchesTerms("Website relaunch", ["site"])).toBe(false);
    expect(matchesTerms("Wdrożenie źródeł", ["zrodel"])).toBe(true);
    expect(matchesTerms("Anything", [])).toBe(true);
  });
});

describe("parseSnippet", () => {
  it("splits marked matches from plain text", () => {
    const snippet = `Designs are in the ${MARK_START}Figma${MARK_END} file…`;
    expect(parseSnippet(snippet)).toEqual([
      { text: "Designs are in the ", match: false },
      { text: "Figma", match: true },
      { text: " file…", match: false },
    ]);
  });

  it("keeps HTML as plain text", () => {
    expect(parseSnippet(`<b>${MARK_START}x${MARK_END}</b>`)).toEqual([
      { text: "<b>", match: false },
      { text: "x", match: true },
      { text: "</b>", match: false },
    ]);
  });
});
