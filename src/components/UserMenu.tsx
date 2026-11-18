"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Avatar from "./Avatar";
import { logoutAction } from "@/server/auth-actions";
import { t, type Locale } from "@/lib/i18n";
import { clearOfflineData, getOfflineState } from "@/lib/offline-store";
import { useUi } from "@/components/ui/UiProvider";

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
  const ui = useUi();
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
        className="flex items-center gap-2 rounded-full p-1 hover:bg-ink/5 transition"
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
          className="absolute right-0 mt-2 w-56 rounded-panel bg-raised border border-line shadow-float z-50 overflow-hidden"
        >
          <Link
            href={`/users/${encodeURIComponent(user.username)}`}
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-ink/5"
          >
            {t("navProfile", locale)}
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-ink/5"
          >
            {t("navSettings", locale)}
          </Link>
          <Link
            href="/trash"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-ink/5"
          >
            {t("navTrash", locale)}
          </Link>
          <Link
            href="/whats-new"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-ink/5"
          >
            {t("navWhatsNew", locale)}
          </Link>
          {isAdmin && (
            <Link
              href="/admin/users"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm hover:bg-ink/5"
            >
              {t("navAdmin", locale)}
            </Link>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const pending = getOfflineState().entries.length;
              if (
                pending > 0 &&
                !(await ui.confirm({
                  title: t("logoutPendingTitle", locale),
                  body: t("logoutPendingBody", locale).replace("{count}", String(pending)),
                  confirmLabel: t("navLogout", locale),
                  danger: true,
                }))
              ) {
                return;
              }
              // Offline copies of boards must not outlive the session.
              await clearOfflineData();
              await logoutAction();
            }}
          >
            <button
              type="submit"
              className="block w-full text-left px-4 py-2 text-sm hover:bg-ink/5 border-t border-line"
            >
              {t("navLogout", locale)}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
