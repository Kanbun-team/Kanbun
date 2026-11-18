"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime, type Locale } from "@/lib/i18n";
import { relativeTime } from "@/lib/activity";

// "5 minutes ago", refreshed every 30 seconds by one shared clock. The server
// render (and hydration) shows the absolute date, so markup always matches;
// the relative text appears right after. The absolute date stays in the title.

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

const getSnapshot = () => now;
const getServerSnapshot = () => 0;

export default function RelativeTime({
  iso,
  locale,
  className,
}: {
  iso: string;
  locale: Locale;
  className?: string;
}) {
  const clock = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const date = new Date(iso);
  const absolute = formatDateTime(date, locale);
  return (
    <time dateTime={iso} title={absolute} className={className}>
      {clock === 0 ? absolute : relativeTime(date, new Date(clock), locale)}
    </time>
  );
}
