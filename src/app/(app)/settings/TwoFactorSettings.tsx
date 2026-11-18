"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { useUi } from "@/components/ui/UiProvider";
import { t, tn, type Locale } from "@/lib/i18n";
import {
  cancelTotpSetupAction,
  confirmTotpSetupAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  startTotpSetupAction,
} from "@/server/two-factor-actions";

interface Props {
  locale: Locale;
  /** Formatted date when 2FA was turned on, or null when off. */
  enabledOn: string | null;
  /** A started setup waiting for confirmation. */
  pending: { qr: string; secret: string; secretGrouped: string; uri: string } | null;
  recoveryLeft: number;
  /** Accounts without a password sign in through SSO; the IdP handles MFA. */
  ssoOnly: boolean;
}

export default function TwoFactorSettings({ locale, enabledOn, pending, recoveryLeft, ssoOnly }: Props) {
  const ui = useUi();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [codes, setCodes] = useState<string[] | null>(null);

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  function confirmSetup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    run(async () => {
      const result = ui.report(await confirmTotpSetupAction(fd));
      if (!result.ok) return;
      form.reset();
      setCodes(result.data.codes);
      ui.toast({ message: t("twoFactorEnabledToast", locale) });
    });
  }

  function manage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(form);
    const intent = submitter?.value;
    run(async () => {
      if (intent === "regenerate") {
        const result = ui.report(await regenerateRecoveryCodesAction(fd));
        if (!result.ok) return;
        form.reset();
        setCodes(result.data.codes);
      } else {
        const result = ui.report(await disableTotpAction(fd));
        if (!result.ok) return;
        form.reset();
        setCodes(null);
        ui.toast({ message: t("twoFactorDisabledToast", locale) });
      }
    });
  }

  async function copyCodes() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      ui.toast({ message: t("twoFactorCopied", locale) });
    } catch {
      // Clipboard unavailable (insecure context): the codes stay on screen to copy by hand.
    }
  }

  return (
    <section
      aria-labelledby="two-factor-title"
      aria-busy={busy || undefined}
      className="bg-surface border border-line rounded-panel p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="two-factor-title" className="text-md font-semibold">{t("twoFactorTitle", locale)}</h2>
        {!ssoOnly && (
          <span
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-control border ${
              enabledOn ? "border-success/50 text-success" : "border-line-strong text-ink-muted"
            }`}
          >
            {enabledOn && <ShieldCheck size={14} aria-hidden="true" />}
            {enabledOn ? t("twoFactorOn", locale).replace("{date}", enabledOn) : t("twoFactorOff", locale)}
          </span>
        )}
      </div>

      {ssoOnly ? (
        <p className="text-sm text-ink-muted">{t("twoFactorSsoOnly", locale)}</p>
      ) : (
        <p className="text-sm text-ink-muted">{t("twoFactorHint", locale)}</p>
      )}

      {codes && (
        <div className="border border-warning/50 bg-warning/10 rounded-control p-3 space-y-2">
          <h3 className="text-sm font-semibold">{t("twoFactorRecoveryTitle", locale)}</h3>
          <p className="text-sm">{t("twoFactorRecoveryHint", locale)}</p>
          <ul aria-label={t("twoFactorRecoveryTitle", locale)} className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
            {codes.map((c) => (
              <li key={c}>
                <code data-recovery-code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={buttonClass("secondary", "sm")} onClick={copyCodes}>
              {t("twoFactorCopyCodes", locale)}
            </button>
            <button type="button" className={buttonClass("primary", "sm")} onClick={() => setCodes(null)}>
              {t("twoFactorSavedCodes", locale)}
            </button>
          </div>
        </div>
      )}

      {!ssoOnly && !enabledOn && !pending && (
        <button
          type="button"
          disabled={busy}
          className={buttonClass("primary", "md")}
          onClick={() => run(async () => void ui.report(await startTotpSetupAction()))}
        >
          {t("twoFactorSetUp", locale)}
        </button>
      )}

      {!ssoOnly && !enabledOn && pending && (
        <div className="space-y-3">
          <p className="text-sm">{t("twoFactorScan", locale)}</p>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
            {/* Always dark on white, so it scans in both themes. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pending.qr}
              alt={t("twoFactorQrAlt", locale)}
              width={176}
              height={176}
              className="rounded-control border border-line bg-white p-2 shrink-0"
            />
            <div className="space-y-2 min-w-0">
              <p className="text-sm text-ink-muted">{t("twoFactorManual", locale)}</p>
              <code
                data-testid="totp-secret"
                data-secret={pending.secret}
                className="block font-mono text-sm break-all bg-paper border border-line rounded-control px-2 py-1"
              >
                {pending.secretGrouped}
              </code>
              <a href={pending.uri} className="inline-block text-sm text-accent hover:underline min-h-6">
                {t("twoFactorOpenApp", locale)}
              </a>
            </div>
          </div>
          <form onSubmit={confirmSetup} className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-sm text-ink-muted">{t("twoFactorCode", locale)}</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                className="w-36 font-mono tracking-wider"
              />
            </label>
            <button disabled={busy} className={buttonClass("primary", "md")}>
              {t("twoFactorTurnOn", locale)}
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass("ghost", "md")}
              onClick={() => run(async () => void ui.report(await cancelTotpSetupAction()))}
            >
              {t("cancel", locale)}
            </button>
          </form>
        </div>
      )}

      {!ssoOnly && enabledOn && (
        <form onSubmit={manage} className="space-y-2">
          <p className="text-sm text-ink-muted">
            {tn("twoFactorRecoveryLeft", recoveryLeft, locale)}
          </p>
          <p className="text-sm text-ink-muted">{t("twoFactorManage", locale)}</p>
          <label className="block max-w-sm">
            <span className="text-sm text-ink-muted">{t("twoFactorCredential", locale)}</span>
            <input name="credential" type="password" autoComplete="off" required maxLength={256} />
          </label>
          <div className="flex gap-2 flex-wrap">
            <button name="intent" value="regenerate" disabled={busy} className={buttonClass("secondary", "md")}>
              {t("twoFactorRegenerate", locale)}
            </button>
            <button name="intent" value="disable" disabled={busy} className={buttonClass("danger", "md")}>
              {t("twoFactorTurnOff", locale)}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
