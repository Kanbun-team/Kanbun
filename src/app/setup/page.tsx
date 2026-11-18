import { redirect } from "next/navigation";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { needsSetup, PASSWORD_MIN_LENGTH } from "@/server/setup";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";

// Step 1 of first-run setup: only reachable while the database has no users.
export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  const locale = await getLocale();
  return (
    <div className="bg-surface border border-line rounded-panel p-6 shadow-float space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-ink-muted">{t("setupStep1", locale)}</p>
        <h1 className="text-lg font-semibold">{t("setupTitle", locale)}</h1>
        <p className="text-sm text-ink-muted">{t("setupIntro", locale)}</p>
      </div>
      <SetupForm locale={locale} minLength={PASSWORD_MIN_LENGTH} />
    </div>
  );
}
