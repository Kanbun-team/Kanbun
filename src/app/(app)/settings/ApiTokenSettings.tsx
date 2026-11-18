"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ActionForm from "@/components/ui/ActionForm";
import RelativeTime from "@/components/ui/RelativeTime";
import SecretReveal from "@/components/ui/SecretReveal";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass } from "@/components/ui/button";
import { formatDate, t, type Locale } from "@/lib/i18n";
import { createApiTokenAction, revokeApiTokenAction } from "@/server/api-token-actions";

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

// The "API tokens" section of the settings page: create a personal access
// token (shown once), list the active and expired ones, revoke.
export default function ApiTokenSettings({
  locale,
  tokens,
  expiryDays,
}: {
  locale: Locale;
  tokens: TokenRow[];
  /** TOKEN_EXPIRY_DAYS, passed in so this client file does not pull in node:crypto. */
  expiryDays: number[];
}) {
  const ui = useUi();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = "text-sm text-ink-muted";

  function create(fd: FormData) {
    startTransition(async () => {
      const result = ui.report(await createApiTokenAction(fd));
      if (!result.ok) return;
      formRef.current?.reset();
      setCreated(result.data.token);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="api-tokens-title" className="bg-surface border border-line rounded-panel p-4 space-y-4">
      <div className="space-y-1">
        <h2 id="api-tokens-title" className="text-md font-semibold">
          {t("settingsApiTokens", locale)}
        </h2>
        <p className="text-sm text-ink-muted">
          {t("settingsApiTokensHint", locale)}{" "}
          <a href="/api/v1/openapi.json" className="text-accent underline underline-offset-2">
            {t("apiTokenDocs", locale)}
          </a>
        </p>
      </div>

      {created && (
        <SecretReveal label={t("apiTokenValue", locale)} value={created} locale={locale} onDone={() => setCreated(null)} />
      )}

      <form
        ref={formRef}
        aria-busy={pending || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          create(new FormData(e.currentTarget));
        }}
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      >
        <label className="block space-y-1">
          <span className={label}>{t("apiTokenName", locale)}</span>
          <input name="name" required maxLength={80} autoComplete="off" />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("apiTokenScope", locale)}</span>
          <select name="scope" defaultValue="read">
            <option value="read">{t("apiTokenScopeRead", locale)}</option>
            <option value="write">{t("apiTokenScopeWrite", locale)}</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("apiTokenExpiry", locale)}</span>
          <select name="expiresInDays" defaultValue="90">
            {expiryDays.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t("apiTokenExpiryNever", locale) : t("apiTokenExpiryDays", locale).replace("{days}", String(d))}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-3">
          <button className={buttonClass("primary")} disabled={pending}>
            {t("apiTokenCreate", locale)}
          </button>
        </div>
      </form>

      {tokens.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("apiTokenNone", locale)}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line" aria-label={t("settingsApiTokens", locale)}>
          {tokens.map((tk) => (
            <li key={tk.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex-1 min-w-[12rem]">
                <div className="font-medium break-words">
                  {tk.name}{" "}
                  <span className="text-xs font-normal rounded-control border border-line px-1.5 py-0.5 text-ink-muted">
                    {tk.scopes === "write" ? t("apiTokenScopeWrite", locale) : t("apiTokenScopeRead", locale)}
                  </span>
                  {tk.expired && (
                    <span className="ml-1 text-xs font-normal rounded-control border border-danger/40 px-1.5 py-0.5 text-danger">
                      {t("apiTokenExpired", locale)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-muted space-x-2">
                  <code className="font-mono">{tk.prefix}…</code>
                  <span>
                    {t("apiTokenLastUsed", locale)}:{" "}
                    {tk.lastUsedAt ? <RelativeTime iso={tk.lastUsedAt} locale={locale} /> : t("apiTokenNeverUsed", locale)}
                  </span>
                  <span>
                    {t("apiTokenExpires", locale)}:{" "}
                    {tk.expiresAt ? formatDate(new Date(tk.expiresAt), locale) : t("apiTokenNoExpiry", locale)}
                  </span>
                </div>
              </div>
              <ActionForm
                action={revokeApiTokenAction}
                success={t("apiTokenRevokedToast", locale)}
                confirm={{
                  title: t("confirmRevokeToken", locale).replace("{name}", tk.name),
                  body: t("confirmRevokeTokenBody", locale),
                  confirmLabel: t("apiTokenRevoke", locale),
                  danger: true,
                }}
              >
                <input type="hidden" name="tokenId" value={tk.id} />
                <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")} aria-label={`${t("apiTokenRevoke", locale)}: ${tk.name}`}>
                  {t("apiTokenRevoke", locale)}
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
