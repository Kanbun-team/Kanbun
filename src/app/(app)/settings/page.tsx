import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { prisma } from "@/lib/db-local";
import { parsePrefs } from "@/lib/notification-prefs";
import { emailEnabled } from "@/server/email";
import SettingsForm from "./SettingsForm";
import NotificationSettings from "./NotificationSettings";
import ApiTokenSettings from "./ApiTokenSettings";
import { TOKEN_EXPIRY_DAYS, tokenState } from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const locale = await getLocale();
  const notif = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, notificationPrefs: true, digestEnabled: true },
  });
  const tokens = await prisma.apiToken.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
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
      <ApiTokenSettings
        locale={locale}
        expiryDays={[...TOKEN_EXPIRY_DAYS]}
        tokens={tokens.map((tk) => ({
          id: tk.id,
          name: tk.name,
          prefix: tk.prefix,
          scopes: tk.scopes,
          createdAt: tk.createdAt.toISOString(),
          lastUsedAt: tk.lastUsedAt?.toISOString() ?? null,
          expiresAt: tk.expiresAt?.toISOString() ?? null,
          expired: tokenState(tk) === "expired",
        }))}
      />
    </div>
  );
}
