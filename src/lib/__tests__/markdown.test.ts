import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml as md } from "@/lib/markdown";

describe("renderMarkdownToHtml", () => {
  it("escapes raw HTML", () => {
    expect(md("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(md('<img src=x onerror="a()">')).not.toContain("<img");
  });

  it("only links http(s) and mailto", () => {
    expect(md("[x](javascript:alert(1))")).not.toContain("<a ");
    expect(md("[x](https://e.com)")).toContain('<a href="https://e.com"');
    expect(md("[x](mailto:a@b.c)")).toContain('href="mailto:a@b.c"');
  });

  it("cannot break out of the href attribute", () => {
    const html = md('[x](https://e.com/"onmouseover="a())');
    expect(html).not.toMatch(/"\s*onmouseover=/);
  });

  it("renders inline formatting", () => {
    expect(md("**b** *i* _i_ ~~s~~ `c`")).toBe(
      '<p><strong>b</strong> <em>i</em> <em>i</em> <del>s</del> <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[0.85em]">c</code></p>'
    );
  });

  it("does not apply formatting inside code spans", () => {
    const html = md("`a **b** _c_`");
    expect(html).toContain(">a **b** _c_</code>");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
  });

  it("keeps link markup intact when underscores follow", () => {
    const html = md("see [docs](https://e.com) and snake_case_name");
    expect(html).toContain('target="_blank"');
    expect(html).not.toMatch(/target="<em>/);
  });

  it("does not format inside URLs", () => {
    const html = md("[x](https://e.com/a_b_c/**d**)");
    expect(html).toContain('href="https://e.com/a_b_c/**d**"');
  });

  it("renders headings and lists", () => {
    expect(md("# T")).toBe("<h3>T</h3>");
    expect(md("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(md("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(md("a\nb\n\nc")).toBe("<p>a<br>b</p><p>c</p>");
  });
});
