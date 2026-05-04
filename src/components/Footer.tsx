import Link from "next/link";
import Logo from "./Logo";
import { t, type Locale } from "@/lib/i18n";
import { editionLabel, getEdition } from "@/lib/edition";

export default async function Footer({ locale }: { locale: Locale }) {
  const year = new Date().getFullYear();
  const { edition } = await getEdition();
  const isPro = edition === "pro";
  return (
    <footer className="border-t border-[var(--border)] mt-12 py-6 px-4 safe-bottom">
      <div className="mx-auto max-w-6xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm opacity-80">
        <div className="flex items-center gap-2 flex-wrap">
          <Logo size={20} />
          <span className="font-medium">{t("appName", locale)}</span>
          <span
            className={
              isPro
                ? "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-600 text-white"
                : "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700"
            }
            title={isPro ? "Kanbun Pro" : "Kanbun Community Edition (AGPL-3.0)"}
          >
            {editionLabel(edition)}
          </span>
          <span>&copy; {year}</span>
          <span>{t("footerCopyright", locale)}</span>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/whats-new" className="hover:underline">{t("navWhatsNew", locale)}</Link>
          <Link href="/settings" className="hover:underline">{t("navSettings", locale)}</Link>
        </nav>
      </div>
    </footer>
  );
}
