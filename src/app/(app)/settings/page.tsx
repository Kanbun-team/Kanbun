import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { prisma } from "@/lib/db-local";
import { parsePrefs } from "@/lib/notification-prefs";
import { emailEnabled } from "@/server/email";
import SettingsForm from "./SettingsForm";
import NotificationSettings from "./NotificationSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const locale = await getLocale();
  const notif = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, notificationPrefs: true, digestEnabled: true },
  });
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold">{t("settingsTitle", locale)}</h1>
      <SettingsForm
        locale={locale}
        initial={{
          theme: user.themePreference,
          language: user.locale,
          displayName: user.displayName ?? user.username,
          avatarUrl: user.avatarUrl ?? "",
        }}
      />
      <NotificationSettings
        locale={locale}
        emailAvailable={emailEnabled()}
        initial={{
          email: notif?.email ?? "",
          prefs: parsePrefs(notif?.notificationPrefs),
          digest: notif?.digestEnabled ?? false,
        }}
      />
    </div>
  );
}
