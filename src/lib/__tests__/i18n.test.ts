import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import pl from "@/locales/pl.json";
import de from "@/locales/de.json";
import it_ from "@/locales/it.json";
import { tn } from "@/lib/i18n";

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

describe("plural forms", () => {
  const all = { en, ...LOCALES } as Record<string, Record<string, string>>;
  const bases = Object.keys(en)
    .filter((k) => k.endsWith("_other"))
    .map((k) => k.slice(0, -"_other".length));
  const intl: Record<string, string> = { en: "en-GB", pl: "pl-PL", it: "it-IT", de: "de-DE" };

  it("every locale has each form its language uses for whole numbers", () => {
    const missing: string[] = [];
    for (const [code, dict] of Object.entries(all)) {
      const rules = new Intl.PluralRules(intl[code]);
      const forms = new Set(Array.from({ length: 200 }, (_, n) => rules.select(n)));
      for (const base of bases) {
        for (const form of forms) if (!dict[`${base}_${form}`]?.trim()) missing.push(`${code}:${base}_${form}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("plural keys never come without their _other form", () => {
    const orphans = Object.entries(all).flatMap(([code, dict]) =>
      Object.keys(dict)
        .filter((k) => /_(zero|one|two|few|many)$/.test(k))
        .filter((k) => !dict[k.replace(/_(zero|one|two|few|many)$/, "_other")])
        .map((k) => `${code}:${k}`)
    );
    expect(orphans).toEqual([]);
  });

  it("picks the form with Intl.PluralRules", () => {
    expect(tn("cardAttachmentsA11y", 1, "en")).toBe("1 attachment");
    expect(tn("cardAttachmentsA11y", 3, "en")).toBe("3 attachments");
    expect(tn("cardAttachmentsA11y", 1, "pl")).toBe("1 za\u0142\u0105cznik");
    expect(tn("cardAttachmentsA11y", 3, "pl")).toBe("3 za\u0142\u0105czniki");
    expect(tn("cardAttachmentsA11y", 5, "pl")).toBe("5 za\u0142\u0105cznik\u00f3w");
    expect(tn("cardAttachmentsA11y", 22, "pl")).toBe("22 za\u0142\u0105czniki");
    expect(tn("cardCommentsA11y", 1, "de")).toBe("1 Kommentar");
    expect(tn("cardCommentsA11y", 0, "it")).toBe("0 commenti");
  });
});
