"use client";

import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
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
      <section className="bg-surface border border-line rounded-panel p-4 space-y-3">
        <h2 className="text-md font-semibold">{t("settingsTheme", locale)}</h2>
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
              className={`rounded-control px-3 py-1 text-sm border ${
                initial.theme === opt
                  ? "border-accent bg-accent-soft"
                  : "border-line-strong hover:bg-ink/5"
              }`}
            >
              {opt === "light" ? t("themeLight", locale) : opt === "dark" ? t("themeDark", locale) : t("themeSystem", locale)}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-surface border border-line rounded-panel p-4 space-y-3">
        <h2 className="text-md font-semibold">{t("settingsLanguage", locale)}</h2>
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
              className={`rounded-control px-3 py-1 text-sm border ${
                initial.language === lng
                  ? "border-accent bg-accent-soft"
                  : "border-line-strong hover:bg-ink/5"
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

      <ActionForm action={updateProfileAction} success={t("savedToast", locale)} className="bg-surface border border-line rounded-panel p-4 space-y-3">
        <h2 className="text-md font-semibold">{t("navProfile", locale)}</h2>
        <label className="block">
          <span className="text-sm text-ink-muted">{t("settingsDisplayName", locale)}</span>
          <input name="displayName" defaultValue={initial.displayName} required maxLength={64} />
        </label>
        <label className="block">
          <span className="text-sm text-ink-muted">{t("settingsAvatar", locale)}</span>
          <input name="avatarUrl" type="url" defaultValue={initial.avatarUrl} maxLength={500} />
        </label>
        <button className={buttonClass("primary")}>{t("save", locale)}</button>
      </ActionForm>
    </div>
  );
}
