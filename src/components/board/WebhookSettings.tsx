"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ActionForm from "@/components/ui/ActionForm";
import RelativeTime from "@/components/ui/RelativeTime";
import SecretReveal from "@/components/ui/SecretReveal";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass } from "@/components/ui/button";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import {
  createWebhookAction,
  deleteWebhookAction,
  setWebhookActiveAction,
  testWebhookAction,
} from "@/server/webhook-actions";

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failureCount: number;
  deliveries: {
    id: string;
    event: string;
    success: boolean;
    statusCode: number | null;
    durationMs: number | null;
    error: string | null;
    attempts: number;
    createdAt: string;
  }[];
}

const eventLabel = (event: string, locale: Locale) => t(`webhookEvent_${event.replace(".", "_")}` as DictKey, locale);

// Board settings: outgoing webhooks. The event list and failure limit come
// from the server (src/lib/webhooks.ts pulls in Node modules).
export default function WebhookSettings({
  boardId,
  webhooks,
  events,
  failureLimit,
  locale,
}: {
  boardId: string;
  webhooks: WebhookRow[];
  events: string[];
  failureLimit: number;
  locale: Locale;
}) {
  const ui = useUi();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = "text-sm text-ink-muted";

  function create(fd: FormData) {
    startTransition(async () => {
      const result = ui.report(await createWebhookAction(fd));
      if (!result.ok) return;
      formRef.current?.reset();
      setSecret(result.data.secret);
      ui.toast({ message: t("webhookAdded", locale) });
      router.refresh();
    });
  }

  function test(webhookId: string) {
    const fd = new FormData();
    fd.set("webhookId", webhookId);
    startTransition(async () => {
      const result = ui.report(await testWebhookAction(fd));
      if (!result.ok) return;
      ui.toast(
        result.data.ok
          ? { message: t("webhookTestOk", locale).replace("{status}", String(result.data.status)) }
          : { message: t("webhookTestFailed", locale), tone: "error" }
      );
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="webhooks-title" className="bg-surface border border-line rounded-panel p-4 space-y-4">
      <div className="space-y-1">
        <h2 id="webhooks-title" className="text-md font-semibold">
          {t("webhooksTitle", locale)}
        </h2>
        <p className="text-sm text-ink-muted">{t("webhooksHint", locale)}</p>
      </div>

      {secret && (
        <SecretReveal label={t("webhookSecret", locale)} value={secret} locale={locale} onDone={() => setSecret(null)} />
      )}

      {webhooks.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("webhookNone", locale)}</p>
      ) : (
        <ul className="space-y-3" aria-label={t("webhooksTitle", locale)}>
          {webhooks.map((w) => (
            <li key={w.id} className="rounded-control border border-line p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-sm break-all flex-1 min-w-0">{w.url}</code>
                <span
                  className={`text-xs rounded-control border px-1.5 py-0.5 ${
                    w.active ? "border-success/50 text-success" : "border-line text-ink-muted"
                  }`}
                >
                  {w.active ? t("webhookActive", locale) : t("webhookInactive", locale)}
                </span>
              </div>
              <p className="text-xs text-ink-muted">{w.events.map((e) => eventLabel(e, locale)).join(", ")}</p>
              {w.failureCount > 0 && (
                <p className="text-xs text-danger">
                  {t("webhookFailing", locale)
                    .replace("{count}", String(w.failureCount))
                    .replace("{limit}", String(failureLimit))}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => test(w.id)}
                  className={buttonClass("secondary", "sm")}
                >
                  {t("webhookTest", locale)}
                </button>
                <ActionForm action={setWebhookActiveAction}>
                  <input type="hidden" name="webhookId" value={w.id} />
                  <input type="hidden" name="active" value={String(!w.active)} />
                  <button className={buttonClass("secondary", "sm")}>
                    {w.active ? t("webhookDisable", locale) : t("webhookEnable", locale)}
                  </button>
                </ActionForm>
                <ActionForm
                  action={deleteWebhookAction}
                  success={t("webhookDeleted", locale)}
                  confirm={{
                    title: t("confirmDeleteWebhook", locale),
                    body: t("confirmDeleteWebhookBody", locale).replace("{url}", w.url),
                    confirmLabel: t("delete", locale),
                    danger: true,
                  }}
                >
                  <input type="hidden" name="webhookId" value={w.id} />
                  <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")}>{t("delete", locale)}</button>
                </ActionForm>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer min-h-6 text-ink-muted hover:text-ink">
                  {t("webhookDeliveries", locale)} ({w.deliveries.length})
                </summary>
                {w.deliveries.length === 0 ? (
                  <p className="pt-2 text-ink-muted">{t("webhookNoDeliveries", locale)}</p>
                ) : (
                  <div className="overflow-x-auto pt-2">
                    <table className="w-full text-xs border-collapse">
                      <caption className="sr-only">{t("webhookDeliveriesCaption", locale).replace("{url}", w.url)}</caption>
                      <thead>
                        <tr className="border-b border-line text-left text-ink-muted">
                          <th scope="col" className="py-1 pr-2 font-medium">{t("webhookColTime", locale)}</th>
                          <th scope="col" className="py-1 pr-2 font-medium">{t("webhookColEvent", locale)}</th>
                          <th scope="col" className="py-1 pr-2 font-medium">{t("webhookColResult", locale)}</th>
                          <th scope="col" className="py-1 pr-2 font-medium">{t("webhookColDuration", locale)}</th>
                          <th scope="col" className="py-1 font-medium">{t("webhookColAttempts", locale)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {w.deliveries.map((d) => (
                          <tr key={d.id} className="border-b border-line last:border-0 align-top">
                            <td className="py-1 pr-2 whitespace-nowrap">
                              <RelativeTime iso={d.createdAt} locale={locale} />
                            </td>
                            <td className="py-1 pr-2 whitespace-nowrap">{eventLabel(d.event, locale)}</td>
                            <td className={`py-1 pr-2 ${d.success ? "text-success" : "text-danger"}`}>
                              {d.success ? t("webhookDeliveryOk", locale) : t("webhookDeliveryFailed", locale)}
                              {d.statusCode ? ` (HTTP ${d.statusCode})` : ""}
                              {!d.success && d.error && <span className="block text-ink-muted break-words">{d.error}</span>}
                            </td>
                            <td className="py-1 pr-2 whitespace-nowrap">{d.durationMs !== null ? `${d.durationMs} ms` : ""}</td>
                            <td className="py-1">{d.attempts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        aria-busy={pending || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          create(new FormData(e.currentTarget));
        }}
        className="space-y-3 border-t border-line pt-3"
      >
        <input type="hidden" name="boardId" value={boardId} />
        <label className="block space-y-1">
          <span className={label}>{t("webhookUrl", locale)}</span>
          <input
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://example.com/hooks/kanbun"
            aria-describedby="webhook-url-hint"
            autoComplete="off"
          />
          <span id="webhook-url-hint" className="block text-xs text-ink-muted">
            {t("webhookUrlHint", locale)}
          </span>
        </label>
        <fieldset className="space-y-1">
          <legend className={label}>{t("webhookEvents", locale)}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {events.map((ev) => (
              <label key={ev} className="inline-flex items-center gap-1.5 min-h-6 cursor-pointer text-sm">
                <input type="checkbox" name="events" value={ev} defaultChecked />
                {eventLabel(ev, locale)}
              </label>
            ))}
          </div>
        </fieldset>
        <button className={buttonClass("primary")} disabled={pending}>
          {t("webhookAdd", locale)}
        </button>
      </form>
    </section>
  );
}
