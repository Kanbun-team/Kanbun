"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction, setThemeAction, updateProfileAction } from "@/server/actions";
import { t, type Locale } from "@/lib/i18n";

interface Props {
  locale: Locale;
  initial: {
    theme: string;
    language: string;
    displayName: string;
    avatarUrl: string;
  };
}

export default function SettingsForm({ locale, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function applyTheme(theme: string) {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else if (theme === "light") document.documentElement.classList.remove("dark");
    else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", prefersDark);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface border rounded-xl p-4 space-y-3">
        <h2 className="font-medium">{t("settingsTheme", locale)}</h2>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={pending}
              onClick={() => {
                applyTheme(opt);
                startTransition(async () => {
                  await setThemeAction(opt);
                  router.refresh();
                });
              }}
              className={`rounded px-3 py-1 text-sm border ${
                initial.theme === opt
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30"
                  : "border-[var(--border)]"
              }`}
            >
              {opt === "light" ? t("themeLight", locale) : opt === "dark" ? t("themeDark", locale) : t("themeSystem", locale)}
            </button>
          ))}
        </div>
      </section>

      <section className="surface border rounded-xl p-4 space-y-3">
        <h2 className="font-medium">{t("settingsLanguage", locale)}</h2>
        <div className="flex gap-2">
          {(["en", "it", "pl", "de"] as const).map((lng) => (
            <button
              key={lng}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setLocaleAction(lng);
                  router.refresh();
                })
              }
              className={`rounded px-3 py-1 text-sm border ${
                initial.language === lng
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30"
                  : "border-[var(--border)]"
              }`}
            >
              {lng === "en" ? t("langEnglish", locale) :
              lng === "it" ? t("langItalian", locale) :
              lng === "pl" ? t("langPolish", locale) :
              lng === "de" ? t("langGerman", locale) :
              t("langEnglish", locale)}
            </button>
          ))}
        </div>
      </section>

      <form action={updateProfileAction} className="surface border rounded-xl p-4 space-y-3">
        <h2 className="font-medium">{t("navProfile", locale)}</h2>
        <label className="block">
          <span className="text-sm opacity-80">{t("settingsDisplayName", locale)}</span>
          <input name="displayName" defaultValue={initial.displayName} required maxLength={64} />
        </label>
        <label className="block">
          <span className="text-sm opacity-80">{t("settingsAvatar", locale)}</span>
          <input name="avatarUrl" type="url" defaultValue={initial.avatarUrl} maxLength={500} />
        </label>
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1.5">
          {t("save", locale)}
        </button>
      </form>
    </div>
  );
}
