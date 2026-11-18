import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import pl from "@/locales/pl.json";
import de from "@/locales/de.json";
import it_ from "@/locales/it.json";

// Every English key must be translated (non-empty) in every locale, and
// placeholders like {name} must survive translation.
const LOCALES = { pl, de, it: it_ } as Record<string, Record<string, string>>;
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("translations", () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    it(`${code} has every key from en.json`, () => {
      const missing = Object.keys(en).filter((k) => !dict[k]?.trim());
      expect(missing).toEqual([]);
    });
    it(`${code} keeps every placeholder`, () => {
      const broken = Object.entries(en as Record<string, string>)
        .filter(([k, v]) => dict[k] && placeholders(v).join() !== placeholders(dict[k]).join())
        .map(([k]) => k);
      expect(broken).toEqual([]);
    });
  }

  it("no em dashes in any UI copy", () => {
    for (const dict of [en, ...Object.values(LOCALES)]) {
      expect(Object.values(dict).filter((v) => String(v).includes("\u2014"))).toEqual([]);
    }
  });
});
