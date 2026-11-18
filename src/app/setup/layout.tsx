import Logo from "@/components/Logo";
import UiProvider from "@/components/ui/UiProvider";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";

export const metadata = { title: "Set up Kanbun" };

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <UiProvider locale={locale}>
      <main className="min-h-screen flex items-start sm:items-center justify-center px-4 py-10 safe-top safe-bottom bg-paper">
        <div className="w-full max-w-lg">
          <div className="flex flex-col items-center mb-8">
            <Logo size={56} />
            <p className="text-3xl font-semibold mt-3 tracking-tight">Kanbun</p>
            <p className="text-sm text-ink-muted mt-1">{t("setupTagline", locale)}</p>
          </div>
          {children}
        </div>
      </main>
    </UiProvider>
  );
}
