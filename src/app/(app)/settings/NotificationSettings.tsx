"use client";

import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import {
  CHANNELS,
  NOTIFICATION_TYPES,
  typeLabelKey,
  type Channel,
  type NotificationPrefs,
} from "@/lib/notification-prefs";
import { updateNotificationSettingsAction } from "@/server/notification-settings-actions";

const CHANNEL_LABEL: Record<Channel, DictKey> = {
  inapp: "notifChannelInApp",
  email: "notifChannelEmail",
  none: "notifChannelNone",
};

// The "Notifications" section of the settings page: one radio group per
// notification type (a table row), the email address and the daily digest.
export default function NotificationSettings({
  locale,
  emailAvailable,
  initial,
}: {
  locale: Locale;
  emailAvailable: boolean;
  initial: { email: string; prefs: NotificationPrefs; digest: boolean };
}) {
  return (
    <ActionForm
      action={updateNotificationSettingsAction}
      success={t("savedToast", locale)}
      aria-labelledby="notif-settings-title"
      className="bg-surface border border-line rounded-panel p-4 space-y-4"
    >
      <div className="space-y-1">
        <h2 id="notif-settings-title" className="text-md font-semibold">
          {t("settingsNotifications", locale)}
        </h2>
        <p className="text-sm text-ink-muted">{t("settingsNotificationsHint", locale)}</p>
      </div>

      {!emailAvailable && (
        <p id="notif-email-off" className="text-sm rounded-control border border-line bg-paper px-3 py-2">
          {t("settingsEmailDisabled", locale)}
        </p>
      )}

      <label className="block">
        <span className="text-sm text-ink-muted">{t("settingsEmail", locale)}</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={initial.email}
          maxLength={254}
          aria-describedby="notif-email-hint"
        />
        <span id="notif-email-hint" className="block text-xs text-ink-muted mt-1">
          {t("settingsEmailHint", locale)}
        </span>
      </label>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">{t("settingsNotifTableCaption", locale)}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="text-left font-medium text-ink-muted py-2 px-1">
                {t("settingsNotifType", locale)}
              </th>
              {CHANNELS.map((ch) => (
                <th key={ch} scope="col" className="font-medium text-ink-muted py-2 px-1 text-center w-24">
                  {t(CHANNEL_LABEL[ch], locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((type) => {
              const label = t(typeLabelKey(type), locale);
              return (
                <tr key={type} className="border-b border-line last:border-0">
                  <th scope="row" className="text-left font-normal py-1 px-1">
                    {label}
                  </th>
                  {CHANNELS.map((ch) => {
                    const disabled = ch === "email" && !emailAvailable;
                    return (
                      <td key={ch} className="text-center py-1 px-1">
                        <label className="inline-flex h-8 w-8 items-center justify-center rounded-control hover:bg-ink/5">
                          <input
                            type="radio"
                            name={`pref_${type}`}
                            value={ch}
                            defaultChecked={initial.prefs[type] === ch}
                            disabled={disabled}
                            aria-describedby={disabled ? "notif-email-off" : undefined}
                          />
                          <span className="sr-only">
                            {label}: {t(CHANNEL_LABEL[ch], locale)}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <label className="flex items-start gap-2 min-h-6">
        <input
          type="checkbox"
          name="digest"
          defaultChecked={initial.digest}
          disabled={!emailAvailable}
          aria-describedby={emailAvailable ? "notif-digest-hint" : "notif-digest-hint notif-email-off"}
          className="mt-1"
        />
        <span>
          <span className="block text-sm">{t("settingsDigest", locale)}</span>
          <span id="notif-digest-hint" className="block text-xs text-ink-muted">
            {t("settingsDigestHint", locale)}
          </span>
        </span>
      </label>

      <button className={buttonClass("primary")}>{t("save", locale)}</button>
    </ActionForm>
  );
}
