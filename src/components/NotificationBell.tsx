"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { t, type Locale, formatDateTime } from "@/lib/i18n";
import { notificationText } from "@/lib/notification-prefs";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/tasks-actions";
import type { NotificationView } from "@/lib/notifications";

interface Props {
  initial: { items: NotificationView[]; unread: number };
  locale: Locale;
}

const messageFor = (n: NotificationView, locale: Locale) => notificationText(n, locale);

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
        aria-label={
          unread > 0
            ? t("notifTitleUnread", locale).replace("{count}", unread > 9 ? "9+" : String(unread))
            : t("notifTitle", locale)
        }
        aria-expanded={open}
        className="relative rounded-control p-1.5 hover:bg-ink/5"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-paper text-xs font-semibold tabular-nums flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-50 w-80 bg-raised border border-line rounded-panel shadow-float overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <span className="text-sm font-semibold">{t("notifTitle", locale)}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs text-ink-muted hover:text-ink"
              >
                {t("notifMarkAllRead", locale)}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-auto" aria-label={t("notifTitle", locale)}>
            {items.length === 0 && (
              <li className="px-3 py-6 text-sm text-ink-muted text-center">{t("notifEmpty", locale)}</li>
            )}
            {items.map((n) => {
              const href = n.boardId ? (n.cardId ? `/tasks/${n.boardId}/cards/${n.cardId}` : `/tasks/${n.boardId}`) : null;
              const body = (
                <div className={cn("flex gap-2 px-3 py-2.5", !n.read && "bg-accent-soft")}>
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0" />}
                  <div className={cn("flex-1 min-w-0", n.read && "pl-4")}>
                    <p className="text-sm leading-snug">{messageFor(n, locale)}</p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {formatDateTime(new Date(n.createdAt), locale)}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={n.id} className="border-b border-line last:border-0">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => {
                        if (!n.read) markRead(n.id);
                        setOpen(false);
                      }}
                      className="block hover:bg-ink/5"
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => !n.read && markRead(n.id)}
                      className="block w-full text-left hover:bg-ink/5"
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
