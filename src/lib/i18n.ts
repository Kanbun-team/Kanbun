import enDict from "@/locales/en.json";
import itDict from "@/locales/it.json";
import plDict from "@/locales/pl.json";
import deDict from "@/locales/de.json";
import frDict from "@/locales/fr.json";
import esDict from "@/locales/es.json";
import ptDict from "@/locales/pt.json";

/**
 * The UI languages, in the order the language picker shows them. This is the
 * one list: the Locale type, the settings schema, Accept-Language matching
 * and the picker all derive from it. Adding a code here makes TypeScript ask
 * for its LOCALE_INFO and DICTS entries.
 */
export const LOCALES = ["en", "it", "pl", "de", "fr", "es", "pt"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export type DictKey = keyof typeof enDict;

interface LocaleInfo {
  /** The language's name in that language, shown in the language picker. */
  name: string;
  /** BCP 47 tag for Intl (dates, numbers, plural rules, sorting). */
  intl: string;
  /** Day numbers are written as ordinals with a trailing dot ("5."). */
  dottedOrdinals?: boolean;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { name: "English", intl: "en-GB" },
  it: { name: "Italiano", intl: "it-IT" },
  pl: { name: "Polski", intl: "pl-PL", dottedOrdinals: true },
  de: { name: "Deutsch", intl: "de-DE", dottedOrdinals: true },
  fr: { name: "Français", intl: "fr-FR" },
  es: { name: "Español", intl: "es-ES" },
  pt: { name: "Português (Brasil)", intl: "pt-BR" },
};

type Dict = Partial<Record<DictKey, string>>;

const DICTS: Record<Locale, Dict> = {
  en: enDict,
  it: itDict as Dict,
  pl: plDict as Dict,
  de: deDict as Dict,
  fr: frDict as Dict,
  es: esDict as Dict,
  pt: ptDict as Dict,
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

/**
 * Base names of the counted texts: en.json has `<base>_one` and
 * `<base>_other`; other locales add the forms their language needs (Polish
 * `_few` and `_many`), chosen with Intl.PluralRules.
 */
export type PluralKey = { [K in DictKey]: K extends `${infer B}_other` ? B : never }[DictKey];

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralCategory(count: number, locale: Locale): string {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(intlLocale(locale))));
  return rules.select(count);
}

/** A counted text in the right plural form, with {count} filled in. */
export function tn(base: PluralKey, count: number, locale: Locale = DEFAULT_LOCALE): string {
  const dict = DICTS[locale] as Record<string, string | undefined>;
  const en = enDict as Record<string, string | undefined>;
  const text =
    dict[`${base}_${pluralCategory(count, locale)}`] ||
    dict[`${base}_other`] ||
    en[`${base}_${pluralCategory(count, "en")}`] ||
    en[`${base}_other`] ||
    base;
  return text.replaceAll("{count}", String(count));
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function intlLocale(locale: Locale): string {
  return (LOCALE_INFO[locale] ?? LOCALE_INFO[DEFAULT_LOCALE]).intl;
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
