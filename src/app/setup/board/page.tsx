import Link from "next/link";
import { redirect } from "next/navigation";
import { safeAuth } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { buttonClass } from "@/components/ui/button";
import FirstBoardForm from "./FirstBoardForm";
import { titleMetadata } from "@/server/page-title";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return titleMetadata("setupBoardTitle");
}

// Step 2 of first-run setup: offer a first board from a built-in template.
export default async function SetupBoardPage() {
  const result = await safeAuth();
  if (result.status !== "ok") redirect("/login");
  const locale = await getLocale();
  return (
    <div className="bg-surface border border-line rounded-panel p-6 shadow-float space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-ink-muted">{t("setupStep2", locale)}</p>
        <h1 className="text-lg font-semibold">{t("setupBoardTitle", locale)}</h1>
        <p className="text-sm text-ink-muted">{t("setupBoardIntro", locale)}</p>
      </div>
      <FirstBoardForm locale={locale} />
      <div className="text-center">
        <Link href="/tasks" className={buttonClass("ghost", "md")}>
          {t("setupSkip", locale)}
        </Link>
      </div>
    </div>
  );
}
