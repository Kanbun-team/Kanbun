"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";

interface Props {
  boards: { id: string; name: string }[];
  isAdmin: boolean;
  locale: Locale;
}

export default function MobileNav({ boards, isAdmin, locale }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={t("navOpenMenu", locale)}
        onClick={() => setOpen(true)}
        className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative ml-auto h-full w-72 max-w-[80%] surface border-l border-[var(--border)] safe-top safe-bottom flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <span className="font-semibold">{t("appName", locale)}</span>
              <button
                onClick={() => setOpen(false)}
                aria-label={t("navCloseMenu", locale)}
                className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-auto p-2 text-sm">
              <Link href="/tasks" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                {t("navBoards", locale)}
              </Link>
              <Link href="/tasks/me" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                {t("navMyTasks", locale)}
              </Link>
              {isAdmin && (
                <Link href="/admin/users" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                  {t("navAdmin", locale)}
                </Link>
              )}
              <Link href="/settings" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                {t("navSettings", locale)}
              </Link>
              <Link href="/whats-new" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                {t("navWhatsNew", locale)}
              </Link>
              {boards.length > 0 && (
                <div className="mt-3">
                  <div className="px-3 py-1 text-xs uppercase tracking-wide opacity-60">
                    {t("boardsTitle", locale)}
                  </div>
                  {boards.map((b) => (
                    <Link
                      key={b.id}
                      href={`/tasks/${b.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 truncate"
                    >
                      {b.name}
                    </Link>
                  ))}
                </div>
              )}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
