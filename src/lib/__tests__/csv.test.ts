import { describe, expect, it } from "vitest";
import { csvField, detectDelimiter, parseCsv, toCsv, unguardField } from "@/lib/csv";

describe("parseCsv", () => {
  it("reads simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quotes, escaped quotes and delimiters inside quotes", () => {
    expect(parseCsv('title,desc\n"Hello, world","She said ""hi"""\n')).toEqual([
      ["title", "desc"],
      ["Hello, world", 'She said "hi"'],
    ]);
  });

  it("keeps line breaks inside quoted fields", () => {
    expect(parseCsv('a,b\r\n"line 1\r\nline 2",x\r\n')).toEqual([
      ["a", "b"],
      ["line 1\r\nline 2", "x"],
    ]);
  });

  it("strips a byte order mark", () => {
    expect(parseCsv("﻿title\nOne")[0]).toEqual(["title"]);
  });

  it("detects semicolons and tabs", () => {
    expect(detectDelimiter("title;column;tags\nA;B;C")).toBe(";");
    expect(detectDelimiter("title\tcolumn\nA\tB")).toBe("\t");
    expect(detectDelimiter('"a;b",c,d\n')).toBe(",");
    expect(parseCsv("title;column\nA;To do")).toEqual([
      ["title", "column"],
      ["A", "To do"],
    ]);
  });

  it("skips blank lines, keeps empty fields and a last line without newline", () => {
    expect(parseCsv("a,b\n\n,x\nlast,")).toEqual([
      ["a", "b"],
      ["", "x"],
      ["last", ""],
    ]);
  });

  it("reads an unclosed quote to the end", () => {
    expect(parseCsv('a\n"open')).toEqual([["a"], ["open"]]);
  });
});

describe("toCsv", () => {
  it("quotes only when needed and round-trips", () => {
    const rows = [
      ["title", "desc"],
      ["Plain", 'With "quotes", commas\nand lines'],
    ];
    const text = toCsv(rows);
    expect(text).toBe('title,desc\r\nPlain,"With ""quotes"", commas\nand lines"\r\n');
    expect(parseCsv(text)).toEqual(rows);
  });

  it("guards spreadsheet formulas and the guard is undone on import", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("- list item")).toBe("'- list item");
    expect(unguardField("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(unguardField("'quoted")).toBe("'quoted");
  });
});
