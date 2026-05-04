import enDict from "@/locales/en.json";
import plDict from "@/locales/pl.json";
import itDict from "@/locales/it.json";

export type Locale = "en" | "it" | "pl";

export const LOCALES: Locale[] = ["en", "it", "pl"];
export const DEFAULT_LOCALE: Locale = "en";

export type DictKey = keyof typeof enDict;

const DICTS: Record<Locale, Partial<Record<DictKey, string>>> = {
  en: enDict,
  it: itDict as Partial<Record<DictKey, string>>,
  pl: plDict as Partial<Record<DictKey, string>>,
};

const warnedKeys = new Set<string>();

function warnMissing(locale: Locale, key: string): void {
  if (process.env.NODE_ENV === "production") return;
  const id = `${locale}:${key}`;
  if (warnedKeys.has(id)) return;
  warnedKeys.add(id);
  console.warn(`[i18n] Missing '${locale}' translation for "${key}", falling back to 'en'.`);
}

export function t(key: DictKey, locale: Locale = DEFAULT_LOCALE): string {
  const value = DICTS[locale]?.[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (locale !== "en") warnMissing(locale, key);
  return enDict[key] ?? key;
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "it" || value === "pl";
}

export function intlLocale(locale: Locale): string {
  return locale === "pl" ? "pl-PL"
    : locale === "it" ? "it-IT"
      : "en-GB";
}

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Locale completeness percentage relative to English.
 * Useful for a dashboard or "translation status" badge.
 */
export function localeCoverage(locale: Locale): number {
  if (locale === "en") return 100;
  const dict = DICTS[locale] ?? {};
  const total = Object.keys(enDict).length;
  if (total === 0) return 100;
  let translated = 0;
  for (const key of Object.keys(enDict) as DictKey[]) {
    const v = dict[key];
    if (typeof v === "string" && v.length > 0) translated += 1;
  }
  return Math.round((translated / total) * 100);
}

/**
 * List keys missing from a locale (vs English source of truth).
 * Useful for a translation contributor flow.
 */
export function missingKeys(locale: Locale): DictKey[] {
  if (locale === "en") return [];
  const dict = DICTS[locale] ?? {};
  return (Object.keys(enDict) as DictKey[]).filter((k) => {
    const v = dict[k];
    return typeof v !== "string" || v.length === 0;
  });
}
