"use client";

import { registerDict, type Dict, type Locale } from "@/lib/i18n";

/**
 * Makes the current language available to client components before they
 * render. The browser bundle only carries English; the server sends the
 * user's language here instead of shipping every translation.
 */
export function LocaleDictionary({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dict | undefined;
  children: React.ReactNode;
}) {
  if (dict) registerDict(locale, dict);
  return children;
}
