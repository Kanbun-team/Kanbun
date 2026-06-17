"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { t, type Locale, type DictKey, formatDateTime } from "@/lib/i18n";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/tasks-actions";
import type { NotificationView } from "@/lib/notifications";

interface Props {
  initial: { items: NotificationView[]; unread: number };
  locale: Locale;
}

function messageFor(n: NotificationView, locale: Locale): string {
  const actor = n.actorName ?? t("notifSomeone", locale);
  const key: DictKey =
    n.type === "assigned" ? "notifAssigned" : n.type === "mention" ? "notifMention" : "notifBlocked";
  return t(key, locale).replace("{actor}", actor).replace("{card}", `"${n.cardTitle}"`);
}

export default function NotificationBell({ initial, locale }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  const { items, unread } = initial;

  // Live: a pushed notification re-fetches the layout (debounced) so the badge
  // and list stay current without a manual refresh.
  useEffect(() => {
    const source = new EventSource("/api/notifications/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    source.addEventListener("notification", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [router]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function markRead(id: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("notificationId", id);
      await markNotificationReadAction(fd);
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("notifTitle", locale)}
        aria-expanded={open}
        className="relative rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-50 w-80 surface border rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-sm font-semibold">{t("notifTitle", locale)}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs opacity-70 hover:opacity-100"
              >
                {t("notifMarkAllRead", locale)}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-auto">
            {items.length === 0 && (
              <li className="px-3 py-6 text-sm opacity-60 text-center">{t("notifEmpty", locale)}</li>
            )}
            {items.map((n) => {
              const href = n.boardId && n.cardId ? `/tasks/${n.boardId}/cards/${n.cardId}` : null;
              const body = (
                <div className={cn("flex gap-2 px-3 py-2.5", !n.read && "bg-brand-50/60 dark:bg-brand-950/30")}>
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-500 shrink-0" />}
                  <div className={cn("flex-1 min-w-0", n.read && "pl-4")}>
                    <p className="text-sm leading-snug">{messageFor(n, locale)}</p>
                    <p className="text-[11px] opacity-50 mt-0.5">
                      {formatDateTime(new Date(n.createdAt), locale)}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={n.id} className="border-b border-[var(--border)] last:border-0">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => {
                        if (!n.read) markRead(n.id);
                        setOpen(false);
                      }}
                      className="block hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => !n.read && markRead(n.id)}
                      className="block w-full text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
