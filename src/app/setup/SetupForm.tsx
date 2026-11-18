"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { t, type Locale } from "@/lib/i18n";
import { buttonClass } from "@/components/ui/button";
import { setupAdminAction, type SetupState } from "@/server/setup-actions";

function SubmitButton({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "w-full disabled:opacity-60")}>
      {pending && <span className="w-4 h-4 rounded-full border-2 border-accent-fg/70 border-t-transparent animate-spin" />}
      {t("setupCreateAdmin", locale)}
    </button>
  );
}

export default function SetupForm({ locale, minLength }: { locale: Locale; minLength: number }) {
  const [state, formAction] = useActionState(setupAdminAction, {} as SetupState);
  const label = "text-sm font-medium text-ink-muted";
  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className={label}>{t("authUsername", locale)}</span>
        <input
          name="username"
          defaultValue={state.username}
          required
          minLength={2}
          maxLength={32}
          pattern="[a-zA-Z0-9_.\-]+"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          aria-describedby="setup-username-hint"
          className="mt-1.5"
        />
      </label>
      <p id="setup-username-hint" className="text-xs text-ink-muted -mt-3">
        {t("setupUsernameHint", locale)}
      </p>
      <label className="block">
        <span className={label}>{t("setupDisplayName", locale)}</span>
        <input name="displayName" defaultValue={state.displayName} maxLength={64} autoComplete="name" className="mt-1.5" />
      </label>
      <label className="block">
        <span className={label}>{t("authPassword", locale)}</span>
        <input
          name="password"
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          aria-describedby="setup-password-hint"
          className="mt-1.5"
        />
      </label>
      <p id="setup-password-hint" className="text-xs text-ink-muted -mt-3">
        {t("setupPasswordHint", locale).replace("{count}", String(minLength))}
      </p>
      <label className="block">
        <span className={label}>{t("setupPasswordConfirm", locale)}</span>
        <input name="confirm" type="password" required minLength={minLength} autoComplete="new-password" className="mt-1.5" />
      </label>
      {state?.error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-control px-3 py-2" role="alert">
          {t(state.error, locale)}
        </p>
      )}
      <SubmitButton locale={locale} />
    </form>
  );
}
