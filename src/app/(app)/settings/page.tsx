import { auth } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  const user = session!.user;
  const locale = await getLocale();
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
    </div>
  );
}
