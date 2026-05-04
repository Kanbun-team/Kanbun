import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "Kanbun",
  description: "Self-hosted task boards.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/icon-192.svg" }],
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

async function resolveTheme(): Promise<"light" | "dark"> {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get("kanbun_theme")?.value;
  if (cookieTheme === "light" || cookieTheme === "dark") return cookieTheme;
  if (cookieTheme === "system") return "dark";
  try {
    const session = await auth();
    const pref = session?.user?.themePreference;
    if (pref === "light") return "light";
    if (pref === "dark") return "dark";
  } catch {}
  return "dark";
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await resolveTheme();
  return (
    <html lang="en" className={theme === "dark" ? "dark" : ""}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
