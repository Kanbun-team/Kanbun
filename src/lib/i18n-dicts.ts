import type { Dict, Locale } from "@/lib/i18n";
import itDict from "@/locales/it.json";
import plDict from "@/locales/pl.json";
import deDict from "@/locales/de.json";
import frDict from "@/locales/fr.json";
import esDict from "@/locales/es.json";
import ptDict from "@/locales/pt.json";
import nlDict from "@/locales/nl.json";
import csDict from "@/locales/cs.json";
import ukDict from "@/locales/uk.json";

/**
 * Every language except English. Server only: the browser build swaps this
 * module for i18n-dicts.browser.ts (see next.config.mjs).
 */
export const OTHER_DICTS: Record<Exclude<Locale, "en">, Dict> = {
  it: itDict,
  pl: plDict,
  de: deDict,
  fr: frDict,
  es: esDict,
  pt: ptDict,
  nl: nlDict,
  cs: csDict,
  uk: ukDict,
};
