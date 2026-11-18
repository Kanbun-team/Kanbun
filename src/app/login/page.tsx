import { Suspense } from "react";
import { redirect } from "next/navigation";
import { safeAuth } from "@/auth";
import Logo from "@/components/Logo";
import LoginForm from "./LoginForm";
import { needsSetup } from "@/server/setup";
import { loginErrorMessage, ssoConfig } from "@/lib/sso";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { titleMetadata } from "@/server/page-title";

export function generateMetadata() {
  return titleMetadata("authLogin");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string; local?: string }>;
}) {
  const sp = await searchParams;
  // A brand-new install has no accounts yet: create the admin in the browser.
  if (await needsSetup()) redirect("/setup");
  const result = await safeAuth();
  if (result.status === "bad-cookie") {
    redirect("/api/auth/clear?to=/login");
  }
  if (result.status === "ok") {
    redirect("/tasks");
  }
  const sso = ssoConfig();
  // With OIDC_DISABLE_PASSWORD the password form is hidden; /login?local=1 is
  // the break-glass path for admins (members are refused in authorize).
  const showPassword = !sso?.disablePassword || sp?.local === "1";
  // Nobody is signed in here: the language comes from the browser
  // (Accept-Language) unless a locale cookie was set before.
  const locale = await getLocale();
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 safe-top safe-bottom bg-paper">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo size={56} />
          <h1 className="text-3xl font-semibold mt-3 tracking-tight">Kanbun</h1>
          <p className="text-sm text-ink-muted mt-1">{t("setupTagline", locale)}</p>
        </div>
        <div className="bg-surface border border-line rounded-panel p-6 shadow-float">
          <h2 className="text-base font-medium mb-4">{t("authSignIn", locale)}</h2>
          <Suspense fallback={null}>
            <LoginForm
              from={sp?.from ?? "/tasks"}
              ssoName={sso?.name ?? null}
              showPassword={showPassword}
              initialError={loginErrorMessage(sp?.error, locale)}
              locale={locale}
            />
          </Suspense>
        </div>
        <p className="text-xs text-center text-ink-muted mt-6">
          {t("authNeedAccount", locale)}
        </p>
      </div>
    </main>
  );
}
