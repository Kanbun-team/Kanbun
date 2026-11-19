import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import { intlLocale, isLocale, LOCALE_INFO, LOCALES, tn } from "@/lib/i18n";

// Every locale file in src/locales, registered or not, so a new translation
// is checked as soon as its file exists.
const DIR = join(__dirname, "..", "..", "locales");
const FILES = Object.fromEntries(
  readdirSync(DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(join(DIR, name), "utf8"))])
) as Record<string, Record<string, string>>;
const LOCALE_FILES = Object.fromEntries(Object.entries(FILES).filter(([code]) => code !== "en"));

// Every English key must be translated (non-empty) in every locale, and
// placeholders like {name} must survive translation.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("translations", () => {
  it("every registered locale has a file and every file is registered", () => {
    expect(Object.keys(FILES).sort()).toEqual([...LOCALES].sort());
  });

  it("every locale has a name in its own language and an Intl tag", () => {
    for (const code of LOCALES) {
      expect(LOCALE_INFO[code].name.trim()).not.toBe("");
      expect(Intl.PluralRules.supportedLocalesOf(intlLocale(code))).toEqual([intlLocale(code)]);
    }
  });

  for (const [code, dict] of Object.entries(LOCALE_FILES)) {
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
    const EM_DASH = String.fromCharCode(0x2014);
    for (const dict of Object.values(FILES)) {
      expect(Object.values(dict).filter((v) => String(v).includes(EM_DASH))).toEqual([]);
    }
  });

  // Every language addresses the user informally, like German "du". Each
  // pattern matches the formal address; a key that matches for another reason
  // (German third-person "Sie" starting a sentence) goes in ALLOW or gets
  // reworded.
  const FORMAL: Record<string, RegExp> = {
    // Capitalized Sie/Ihr/Ihnen.
    de: /(^|[^\p{L}])(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?![\p{L}])/u,
    // tu, never vous.
    fr: /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu,
    // tú, never usted.
    es: /(^|[^\p{L}])(usted|ustedes)(?![\p{L}])/iu,
    // Brazilian você, never o senhor nor the European tu.
    pt: /(^|[^\p{L}])(o senhor|a senhora|tu|teu|tua|teus|tuas|contigo|vós)(?![\p{L}])/iu,
  };
  const ALLOW = new Set<string>([]);
  for (const [code, pattern] of Object.entries(FORMAL)) {
    it(`${code} uses the informal address`, () => {
      const formal = Object.entries(FILES[code] ?? {})
        .filter(([k, v]) => !ALLOW.has(`${code}:${k}`) && pattern.test(v))
        .map(([k, v]) => `${k}: ${v}`);
      expect(formal).toEqual([]);
    });
  }
});

describe("plural forms", () => {
  const bases = Object.keys(en)
    .filter((k) => k.endsWith("_other"))
    .map((k) => k.slice(0, -"_other".length));
  const intl = (code: string) => (isLocale(code) ? intlLocale(code) : code);

  it("every locale has each form its language uses for whole numbers", () => {
    const missing: string[] = [];
    for (const [code, dict] of Object.entries(FILES)) {
      const rules = new Intl.PluralRules(intl(code));
      const forms = new Set(Array.from({ length: 200 }, (_, n) => rules.select(n)));
      for (const base of bases) {
        for (const form of forms) if (!dict[`${base}_${form}`]?.trim()) missing.push(`${code}:${base}_${form}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("plural keys never come without their _other form", () => {
    const orphans = Object.entries(FILES).flatMap(([code, dict]) =>
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
    expect(tn("cardAttachmentsA11y", 1, "pl")).toBe("1 załącznik");
    expect(tn("cardAttachmentsA11y", 3, "pl")).toBe("3 załączniki");
    expect(tn("cardAttachmentsA11y", 5, "pl")).toBe("5 załączników");
    expect(tn("cardAttachmentsA11y", 22, "pl")).toBe("22 załączniki");
    expect(tn("cardCommentsA11y", 1, "de")).toBe("1 Kommentar");
    expect(tn("cardCommentsA11y", 0, "it")).toBe("0 commenti");
    // French and Brazilian Portuguese use the singular for 0, Spanish does not.
    expect(tn("cardCommentsA11y", 0, "fr")).toBe("0 commentaire");
    expect(tn("cardCommentsA11y", 2, "fr")).toBe("2 commentaires");
    expect(tn("cardCommentsA11y", 0, "es")).toBe("0 comentarios");
    expect(tn("cardCommentsA11y", 1, "es")).toBe("1 comentario");
    expect(tn("cardCommentsA11y", 0, "pt")).toBe("0 comentário");
    expect(tn("cardCommentsA11y", 5, "pt")).toBe("5 comentários");
    // A million is "many" in these languages; with no _many form it uses _other.
    expect(tn("cardCommentsA11y", 1_000_000, "fr")).toBe("1000000 commentaires");
  });
});
