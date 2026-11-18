"use client";

import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n";
import { startSsoLinkAction, unlinkSsoAction } from "@/server/sso-actions";

interface Props {
  locale: Locale;
  provider: string;
  /** Whether SSO is configured right now (linking needs it, unlinking does not). */
  available: boolean;
  identity: { email: string | null } | null;
  canUnlink: boolean;
  notice: { tone: "success" | "error"; message: string } | null;
}

export default function ConnectedAccounts({ locale, provider, available, identity, canUnlink, notice }: Props) {
  const p = (key: Parameters<typeof t>[0]) => t(key, locale).replace("{provider}", provider);
  return (
    <section aria-labelledby="sso-title" className="bg-surface border border-line rounded-panel p-4 space-y-3">
      <h2 id="sso-title" className="text-md font-semibold">{t("ssoSectionTitle", locale)}</h2>
      <p className="text-sm text-ink-muted">{p("ssoSectionHint")}</p>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`text-sm rounded-control px-3 py-2 border ${
            notice.tone === "error" ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10"
          }`}
        >
          {notice.message}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium">{provider}</div>
          <div className="text-sm text-ink-muted truncate">
            {identity
              ? identity.email
                ? t("ssoLinkedAs", locale).replace("{email}", identity.email)
                : t("ssoLinked", locale)
              : t("ssoNotLinked", locale)}
          </div>
        </div>
        {identity ? (
          canUnlink ? (
            <ActionForm
              action={unlinkSsoAction}
              success={t("ssoUnlinkedToast", locale)}
              confirm={{
                title: p("ssoUnlinkConfirm"),
                body: t("ssoUnlinkConfirmBody", locale),
                confirmLabel: t("ssoUnlink", locale),
                danger: true,
              }}
            >
              <button className={buttonClass("secondary", "md")}>{t("ssoUnlink", locale)}</button>
            </ActionForm>
          ) : null
        ) : available ? (
          <form action={startSsoLinkAction}>
            <button className={buttonClass("primary", "md")}>{p("ssoLink")}</button>
          </form>
        ) : null}
      </div>
      {identity && !canUnlink && <p className="text-sm text-ink-muted">{p("ssoOnlyNotice")}</p>}
    </section>
  );
}
