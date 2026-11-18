"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";

// Sub-navigation for the admin area. Each admin page adds one entry here.
const TABS = [
  { href: "/admin/users", key: "adminUsers" },
  { href: "/admin/audit", key: "adminAudit" },
  { href: "/admin/data", key: "adminData" },
] as const;

export default function AdminTabs({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  return (
    <nav aria-label={t("adminNavLabel", locale)} className="border-b border-line overflow-x-auto">
      <ul className="flex gap-1 -mb-px">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center h-10 px-3 text-base whitespace-nowrap border-b-2 transition-colors duration-[120ms] ${
                  active ? "border-accent text-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {t(tab.key, locale)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
