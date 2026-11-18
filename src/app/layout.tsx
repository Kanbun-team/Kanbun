import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { getLocale } from "@/lib/get-locale";

export const metadata: Metadata = {
  title: "Kanbun",
  description: "Self-hosted task boards.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml" },
    ],
    // iOS ignores SVG touch icons.
    apple: [{ url: "/icons/kanbun-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kanbun",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

type ThemeSetting = "light" | "dark" | "system";

async function resolveTheme(): Promise<ThemeSetting> {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get("kanbun_theme")?.value;
  if (cookieTheme === "light" || cookieTheme === "dark" || cookieTheme === "system") {
    return cookieTheme;
  }
  try {
    const session = await auth();
    const pref = session?.user?.themePreference;
    if (pref === "light" || pref === "dark" || pref === "system") return pref;
  } catch {}
  return "system";
}

// Runs before first paint when the theme follows the OS, so there is no flash
// of the wrong theme, and keeps following it if the OS setting changes.
const SYSTEM_THEME_SCRIPT = `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){document.documentElement.classList.toggle("dark",m.matches)}a();m.addEventListener("change",a)})()`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, locale, requestHeaders] = await Promise.all([resolveTheme(), getLocale(), headers()]);
  // Set by src/proxy.ts with the Content-Security-Policy of this request.
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html
      lang={locale}
      className={theme === "dark" ? "dark" : undefined}
      // The system-theme script toggles the class before hydration.
      suppressHydrationWarning={theme === "system"}
    >
      <head>
        {theme === "system" && <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />}
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
