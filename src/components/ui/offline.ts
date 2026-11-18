"use client";

// For edits that need the server (everything except the queued board card
// edits): say so while offline instead of failing, and never lose what the
// user typed. Components call `blockedOffline` before an optimistic update
// and wrap the server action call in `sendOrWarn`.

import { unstable_rethrow } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { isOnline } from "@/lib/use-online";
import type { ToastOptions } from "./UiProvider";

interface Ui {
  locale: Locale;
  toast: (options: ToastOptions) => void;
}

/** True (with a toast) while the browser is offline. */
export function blockedOffline(ui: Ui): boolean {
  if (isOnline()) return false;
  ui.toast({ message: t("offlineUnavailable", ui.locale), tone: "error" });
  return true;
}

/**
 * Runs a server action call; when the request itself fails (connection lost)
 * shows a toast and resolves to undefined instead of throwing to the error
 * page. Next.js redirects and not-found signals pass through.
 */
export async function sendOrWarn<T>(ui: Ui, call: () => Promise<T>): Promise<T | undefined> {
  if (blockedOffline(ui)) return undefined;
  try {
    return await call();
  } catch (error) {
    unstable_rethrow(error);
    ui.toast({ message: t(isOnline() ? "networkError" : "offlineUnavailable", ui.locale), tone: "error" });
    return undefined;
  }
}
