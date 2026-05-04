"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Avatar from "./Avatar";
import { logoutAction } from "@/server/auth-actions";
import { t, type Locale } from "@/lib/i18n";

interface Props {
  user: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
  };
  locale: Locale;
}

export default function UserMenu({ user, locale }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const isAdmin = user.role === "admin";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full p-1 hover:bg-slate-200/40 dark:hover:bg-slate-700/40 transition"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar src={user.avatarUrl} name={user.displayName ?? user.username} size={32} />
        <span className="hidden md:inline text-sm font-medium pr-2">
          {user.displayName ?? user.username}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-xl surface border shadow-lg z-50 overflow-hidden"
        >
          <Link
            href={`/users/${encodeURIComponent(user.username)}`}
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("navProfile", locale)}
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("navSettings", locale)}
          </Link>
          <Link
            href="/whats-new"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("navWhatsNew", locale)}
          </Link>
          {isAdmin && (
            <Link
              href="/admin/users"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t("navAdmin", locale)}
            </Link>
          )}
          <form action={logoutAction}>
            <button
              type="submit"
              className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 border-t border-[var(--border)]"
            >
              {t("navLogout", locale)}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
