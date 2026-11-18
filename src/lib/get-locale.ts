import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import { localeFromAcceptLanguage } from "@/lib/accept-language";

export const LOCALE_COOKIE = "kanbun_locale";

/**
 * The reader's language: the locale cookie, then the signed-in user's setting,
 * then the browser's Accept-Language (so the login and setup screens speak it
 * too), then English.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieLocale)) return cookieLocale;
  } catch {
    // cookies() may throw outside a request scope, ignore.
  }

  try {
    const session = await auth();
    const sessionLocale = (session?.user as { locale?: string } | undefined)?.locale;
    if (isLocale(sessionLocale)) return sessionLocale;
    if (session?.user?.id) {
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { locale: true },
      });
      if (isLocale(dbUser?.locale)) return dbUser!.locale as Locale;
    }
  } catch {
    // ignore
  }

  try {
    const fromBrowser = localeFromAcceptLanguage((await headers()).get("accept-language"));
    if (fromBrowser) return fromBrowser;
  } catch {
    // headers() may throw outside a request scope, ignore.
  }

  return DEFAULT_LOCALE;
}
