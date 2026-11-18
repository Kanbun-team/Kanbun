import QRCode from "qrcode";
import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { formatDate, t, type DictKey } from "@/lib/i18n";
import { hasUsablePassword } from "@/lib/password";
import { SSO_PROVIDER_ID, passwordLoginAllowed, ssoConfig } from "@/lib/sso";
import { formatSecret, otpauthUri } from "@/lib/totp";
import { readTotpSecret } from "@/server/two-factor";
import { prisma } from "@/lib/db-local";
import { parsePrefs } from "@/lib/notification-prefs";
import { emailEnabled } from "@/server/email";
import SettingsForm from "./SettingsForm";
import NotificationSettings from "./NotificationSettings";
import ApiTokenSettings from "./ApiTokenSettings";
import { TOKEN_EXPIRY_DAYS, tokenState } from "@/lib/api-tokens";
import TwoFactorSettings from "./TwoFactorSettings";
import ConnectedAccounts from "./ConnectedAccounts";

export const dynamic = "force-dynamic";

const SSO_NOTICE_KEYS: Record<string, DictKey> = {
  SsoIdentityInUse: "ssoErrorIdentityInUse",
  SsoAlreadyLinked: "ssoErrorAlreadyLinked",
  SsoDeactivated: "error_unauthorized",
};

async function pendingSetup(stored: string | null, username: string) {
  const secret = readTotpSecret(stored);
  if (!secret) return null;
  const uri = otpauthUri({ issuer: "Kanbun", account: username, secret });
  const svg = await QRCode.toString(uri, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return {
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    secret,
    secretGrouped: formatSecret(secret),
    uri,
  };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  const user = await requirePageUser();
  const locale = await getLocale();
  const sp = await searchParams;
  const sso = ssoConfig();
  const security = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      role: true,
      passwordHash: true,
      totpSecret: true,
      totpEnabledAt: true,
      identities: { where: { provider: SSO_PROVIDER_ID }, select: { email: true }, take: 1 },
      _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
    },
  });
  const hasPassword = hasUsablePassword(security?.passwordHash);
  const identity = security?.identities[0] ?? null;
  const providerName = sso?.name ?? "SSO";
  const ssoNotice =
    sp?.sso === "linked"
      ? { tone: "success" as const, message: t("ssoLinkedNotice", locale).replace("{provider}", providerName) }
      : sp?.sso
        ? {
            tone: "error" as const,
            message: t(SSO_NOTICE_KEYS[sp.sso] ?? "ssoErrorGeneric", locale).replace("{provider}", providerName),
          }
        : null;
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
      {(sso || identity) && (
        <ConnectedAccounts
          locale={locale}
          provider={providerName}
          available={!!sso}
          identity={identity}
          canUnlink={hasPassword && passwordLoginAllowed(security?.role ?? "member", sso)}
          notice={ssoNotice}
        />
      )}
      <TwoFactorSettings
        locale={locale}
        enabledOn={security?.totpEnabledAt ? formatDate(security.totpEnabledAt, locale) : null}
        pending={
          security && !security.totpEnabledAt && hasPassword
            ? await pendingSetup(security.totpSecret, user.username)
            : null
        }
        recoveryLeft={security?._count.recoveryCodes ?? 0}
        ssoOnly={!hasPassword}
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
