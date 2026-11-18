import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import it_ from "@/locales/it.json";
import pl from "@/locales/pl.json";
import de from "@/locales/de.json";

// Every key in en.json must be used somewhere in src: unused keys pile up and
// cost translators time. A key counts as used when it appears as a quoted
// string ("key", 'key' or `key`) in a source file outside the tests.
//
// Keys built at runtime are matched by prefix instead. Keep this list short
// and point at the code that builds them:
const DYNAMIC_PREFIXES = [
  "error_", // UiProvider errorMessage(): `error_${code}` for every ActionError code
  "importError_", // transfer/import-errors.ts: `importError_${failure.error}`
  "webhookEvent_", // WebhookSettings eventLabel(): `webhookEvent_${event}`
  "audit_", // lib/audit-labels.ts: `audit_${action}`
  "auditTarget_", // lib/audit-labels.ts: `auditTarget_${type}`
];
// Plural forms (`<base>_one`, `_few`, `_many`, `_other`) count as used when
// their base is, as in tn("<base>", count).
const PLURAL = /_(zero|one|two|few|many|other)$/;

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "locales" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("i18n keys", () => {
  const source = sourceFiles(SRC)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const quoted = new Set(Array.from(source.matchAll(/["'`]([A-Za-z][A-Za-z0-9_]*)["'`]/g), (m) => m[1]));

  it("every key in en.json is used in src", () => {
    const unused = Object.keys(en).filter((key) => {
      if (DYNAMIC_PREFIXES.some((p) => key.startsWith(p))) return false;
      return !quoted.has(key) && !(PLURAL.test(key) && quoted.has(key.replace(PLURAL, "")));
    });
    expect(unused).toEqual([]);
  });

  it("other locales have no keys that en.json lacks (besides their extra plural forms)", () => {
    const orphans = Object.entries({ it: it_, pl, de }).flatMap(([code, dict]) =>
      Object.keys(dict)
        .filter((k) => !(k in en))
        .filter((k) => !(PLURAL.test(k) && `${k.replace(PLURAL, "")}_other` in en))
        .map((k) => `${code}:${k}`)
    );
    expect(orphans).toEqual([]);
  });

  it("the dynamic prefixes still match keys", () => {
    for (const prefix of DYNAMIC_PREFIXES) {
      expect(Object.keys(en).some((k) => k.startsWith(prefix)), prefix).toBe(true);
    }
  });
});
