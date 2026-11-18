import { getLocale } from "@/lib/get-locale";
import { t, formatDate } from "@/lib/i18n";
import { CHANGELOG, localizedItems, localizedTitle } from "@/lib/changelog";
import { titleMetadata } from "@/server/page-title";

export function generateMetadata() {
  return titleMetadata("whatsNewTitle");
}

export default async function WhatsNewPage() {
  const locale = await getLocale();
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">{t("whatsNewTitle", locale)}</h1>
      <div className="space-y-4">
        {CHANGELOG.map((entry) => (
          <article key={entry.date} className="bg-surface border border-line rounded-panel p-4">
            <header className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">{localizedTitle(entry, locale)}</h2>
              <time className="text-xs text-ink-muted">
                {formatDate(new Date(entry.date), locale)}
              </time>
            </header>
            <ul className="divide-y divide-line">
              {localizedItems(entry, locale).map((it, i) => (
                <li key={i} className="py-2 text-sm">
                  {it}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
