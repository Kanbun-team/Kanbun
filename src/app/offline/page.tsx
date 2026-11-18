import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/get-locale";
import StatusPage from "@/components/StatusPage";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Kanbun" };

// Served by the service worker (public/sw.js) for pages that were not stored
// for offline use. Offline, the link falls back to a full page load, which
// the worker answers from its cache when that page was stored.
export default async function OfflinePage() {
  const locale = await getLocale();
  return (
    <main className="px-4">
      <StatusPage title={t("offlinePageTitle", locale)} body={t("offlinePageBody", locale)}>
        <Link href="/tasks" prefetch={false} className={buttonClass("primary")}>
          {t("backToBoards", locale)}
        </Link>
      </StatusPage>
    </main>
  );
}
