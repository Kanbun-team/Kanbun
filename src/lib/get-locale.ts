import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const LOCALE_COOKIE = "kanbun_locale";

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

  return DEFAULT_LOCALE;
}
