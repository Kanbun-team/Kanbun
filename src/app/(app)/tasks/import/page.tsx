import Link from "next/link";
import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { maxImportBytes } from "@/server/transfer/http";
import ImportBoardForm from "@/components/transfer/ImportBoardForm";

export const dynamic = "force-dynamic";

export default async function ImportBoardPage() {
  await requirePageUser();
  const locale = await getLocale();
  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/tasks" className="text-sm text-ink-muted hover:text-ink">
        &larr; {t("navBoards", locale)}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{t("importTitle", locale)}</h1>
        <p className="text-sm text-ink-muted mt-1 max-w-prose">{t("importIntro", locale)}</p>
      </div>
      <ImportBoardForm locale={locale} maxBytes={maxImportBytes()} />
      <section className="text-sm text-ink-muted space-y-2 max-w-prose" aria-labelledby="import-help">
        <h2 id="import-help" className="text-md font-semibold text-ink">{t("importHelpTitle", locale)}</h2>
        <p>{t("importHelpTrello", locale)}</p>
        <p>{t("importHelpKanbun", locale)}</p>
        <p>{t("importHelpCsv", locale)}</p>
      </section>
    </div>
  );
}
