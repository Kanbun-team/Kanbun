import Link from "next/link";
import Logo from "./Logo";
import { t, type Locale } from "@/lib/i18n";
import { editionLabel, getEdition } from "@/lib/edition";
import { versionLabel, versionTooltip, versionUrl } from "@/lib/version";

export default async function Footer({ locale }: { locale: Locale }) {
  const year = new Date().getFullYear();
  const { edition } = await getEdition();
  const isPro = edition === "pro";
  return (
    <footer className="border-t border-line mt-12 py-6 px-4 sm:px-6 safe-bottom">
      <div className="mx-auto max-w-7xl group-has-[[data-wide]]/app:max-w-none flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-ink-muted">
        <div className="flex items-center gap-2 flex-wrap">
          <Logo size={20} />
          <span className="font-medium">{t("appName", locale)}</span>
          <span
            className={
              isPro
                ? "text-xs font-medium px-1.5 py-0.5 rounded-control bg-accent text-accent-fg"
                : "text-xs font-medium px-1.5 py-0.5 rounded-control bg-ink/5 text-ink-muted"
            }
            title={isPro ? "Kanbun Pro" : "Kanbun Community Edition (AGPL-3.0)"}
          >
            {editionLabel(edition)}
          </span>
          <a
            href={versionUrl()}
            target="_blank"
            rel="noopener noreferrer"
            title={versionTooltip()}
            className="text-xs font-mono hover:text-ink hover:underline"
          >
            {versionLabel()}
          </a>
          <span>&copy; {year}</span>
          <span>{t("footerCopyright", locale)}</span>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/whats-new" className="hover:text-ink hover:underline">{t("navWhatsNew", locale)}</Link>
          <Link href="/settings" className="hover:text-ink hover:underline">{t("navSettings", locale)}</Link>
        </nav>
      </div>
    </footer>
  );
}
