import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Download, Upload } from "lucide-react";
import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { buttonClass } from "@/components/ui/button";
import { isSqliteUrl } from "@/server/backup";

export const dynamic = "force-dynamic";

export default async function AdminDataPage() {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/tasks");
  const locale = await getLocale();
  const sqlite = isSqliteUrl();
  const card = "bg-surface border border-line rounded-panel p-4 space-y-3";

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">{t("adminData", locale)}</h1>

      <section className={card} aria-labelledby="backup-title">
        <h2 id="backup-title" className="text-md font-semibold">{t("backupTitle", locale)}</h2>
        {sqlite ? (
          <>
            <p className="text-sm text-ink-muted max-w-prose">{t("backupBody", locale)}</p>
            <a href="/api/admin/backup" download className={buttonClass("primary", "md")}>
              <Archive size={16} aria-hidden />
              {t("backupDownload", locale)}
            </a>
            <p className="text-sm text-ink-muted max-w-prose">{t("backupRestoreHint", locale)}</p>
          </>
        ) : (
          <p className="text-sm text-ink-muted max-w-prose">{t("backupUnsupported", locale)}</p>
        )}
      </section>

      <section className={card} aria-labelledby="export-title">
        <h2 id="export-title" className="text-md font-semibold">{t("exportAllTitle", locale)}</h2>
        <p className="text-sm text-ink-muted max-w-prose">{t("exportAllBody", locale)}</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/admin/export" download className={buttonClass("secondary", "md")}>
            <Download size={16} aria-hidden />
            {t("exportAllDownload", locale)}
          </a>
          <a href="/api/admin/export?activity=1" download className={buttonClass("secondary", "md")}>
            <Download size={16} aria-hidden />
            {t("exportAllWithHistory", locale)}
          </a>
        </div>
      </section>

      <section className={card} aria-labelledby="import-title">
        <h2 id="import-title" className="text-md font-semibold">{t("importTitle", locale)}</h2>
        <p className="text-sm text-ink-muted max-w-prose">{t("importAdminBody", locale)}</p>
        <Link href="/tasks/import" className={buttonClass("secondary", "md")}>
          <Upload size={16} aria-hidden />
          {t("importOpen", locale)}
        </Link>
      </section>
    </div>
  );
}
