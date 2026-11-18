import { isLocale, type Locale } from "@/lib/i18n";

/**
 * The best supported locale for an Accept-Language header ("pl-PL,pl;q=0.9,
 * en;q=0.8"), by quality and then by order, matching on the language part
 * only. Null when nothing in the header is supported.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranges = header
    .slice(0, 512)
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((r) => r.lang && r.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const r of ranges) if (isLocale(r.lang)) return r.lang;
  return null;
}
