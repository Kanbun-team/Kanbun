"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import RelativeTime from "@/components/ui/RelativeTime";
import { t, tn, type Locale } from "@/lib/i18n";

// "Offline: showing data from 5 minutes ago" and "2 changes waiting to sync".
// The live region stays mounted so the change is announced.
export default function OfflineBanner({
  showOffline,
  dataTime,
  pending,
  syncing,
  locale,
}: {
  showOffline: boolean;
  dataTime?: string;
  pending: number;
  syncing: boolean;
  locale: Locale;
}) {
  const visible = showOffline || pending > 0;
  const [before, after] = t("offlineBanner", locale).split("{time}");
  const pendingText = tn("offlinePending", pending, locale);
  return (
    <div role="status" aria-live="polite">
      {visible && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-warning/40 bg-surface px-3 py-2 text-sm">
          {showOffline && (
            <p className="flex items-center gap-2 font-medium">
              <CloudOff size={16} aria-hidden className="text-warning shrink-0" />
              <span>
                {dataTime ? (
                  <>
                    {before}
                    {/* Mid-sentence: "5 minutes ago", not "5 Minutes ago" or "Now". */}
                    <span className="inline-block first-letter:lowercase">
                      <RelativeTime iso={dataTime} locale={locale} />
                    </span>
                    {after}
                  </>
                ) : (
                  t("offlineBannerNoTime", locale)
                )}
              </span>
            </p>
          )}
          {pending > 0 && (
            <p className="flex items-center gap-2 text-ink-muted" data-testid="offline-pending">
              <RefreshCw size={14} aria-hidden className={syncing ? "animate-spin motion-reduce:animate-none" : undefined} />
              {syncing ? t("offlineSyncing", locale).replace("{count}", String(pending)) : pendingText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
