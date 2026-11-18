"use client";

// App-wide offline support, mounted once in the signed-in layout:
// - registers the service worker (production builds only), tells it who is
//   signed in, and offers a reload when a new version is installed;
// - asks it to store pages reached by client-side navigation, so they can be
//   reloaded offline later;
// - replays the outbox of queued card edits when the connection returns.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUi } from "@/components/ui/UiProvider";
import { t, type Locale } from "@/lib/i18n";
import { SYNC_EVENT, flushOutbox, useOfflineState } from "@/lib/offline-store";
import { isOnline, useOnline } from "@/lib/use-online";
import { retryableError, runOutboxOp } from "@/components/board/offline-runner";

const SW_ENABLED = process.env.NODE_ENV === "production";
const RETRY_MS = 15_000;

function post(message: unknown) {
  void navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage(message)).catch(() => {});
}

function loadedAssets(): string[] {
  const urls = new Set<string>();
  for (const entry of performance.getEntriesByType("resource")) {
    if (entry.name.includes("/_next/static/")) urls.add(entry.name);
  }
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(s.src));
  document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet][href]").forEach((l) => urls.add(l.href));
  return [...urls].filter((u) => u.includes("/_next/static/"));
}

export default function PwaClient({
  userId,
  version,
  locale,
}: {
  userId: string;
  version: string;
  locale: Locale;
}) {
  const ui = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const offline = useOfflineState(userId);
  const reloading = useRef(false);
  const toastRef = useRef(ui.toast);
  useEffect(() => {
    toastRef.current = ui.toast;
  }, [ui.toast]);

  // Registration and the update flow.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!SW_ENABLED) {
      // `next dev` on an origin that once ran a production build: a stale
      // worker would serve old pages and assets.
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => {});
      return;
    }
    let cancelled = false;
    const offerReload = (worker: ServiceWorker) => {
      toastRef.current({
        message: t("pwaUpdateAvailable", locale),
        action: {
          label: t("pwaReload", locale),
          onAction: () => {
            reloading.current = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    };
    const onControllerChange = () => {
      if (reloading.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        // An update is waiting only when a worker already controls the page.
        if (reg.waiting && navigator.serviceWorker.controller) offerReload(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) offerReload(installing);
          });
        });
      })
      .catch(() => {
        // No service worker (e.g. plain HTTP on a LAN address): the app still works online.
      });
    post({ type: "user", userId });
    post({ type: "precache", urls: loadedAssets() });
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [userId, version, locale]);

  // Store every page reached by client-side navigation (the first page load
  // went through the worker already, or happened before it was installed).
  useEffect(() => {
    if (!SW_ENABLED || !("serviceWorker" in navigator) || !isOnline()) return;
    const timer = setTimeout(() => {
      post({ type: "cache-page", url: window.location.href });
      post({ type: "precache", urls: loadedAssets() });
    }, 1500);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Replay queued edits when back online.
  const flushing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = async () => {
      if (flushing.current || retryTimer.current || !isOnline()) return;
      flushing.current = true;
      try {
        const { synced, failed, interrupted } = await flushOutbox(runOutboxOp, retryableError);
        if (interrupted) {
          // The server is unreachable although the browser says online: try again later.
          retryTimer.current = setTimeout(() => {
            retryTimer.current = undefined;
            flushRef.current();
          }, RETRY_MS);
        }
        if (failed.length > 0) {
          const labels = failed.map((f) => `"${f.entry.label}"`);
          const list = labels.length > 5 ? `${labels.slice(0, 5).join(", ")}, ...` : labels.join(", ");
          ui.toast({
            message: t("syncFailed", locale).replace("{count}", String(failed.length)).replace("{list}", list),
            tone: "error",
          });
        } else if (synced.length > 0) {
          ui.toast({ message: t("syncDone", locale) });
        }
        if (synced.length > 0 || failed.length > 0) router.refresh();
      } finally {
        flushing.current = false;
      }
    };
  }, [ui, locale, router]);

  useEffect(() => {
    const request = () => flushRef.current();
    const now = () => {
      // Reconnected: skip the back-off.
      clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
      request();
    };
    window.addEventListener("online", now);
    window.addEventListener(SYNC_EVENT, now);
    return () => {
      clearTimeout(retryTimer.current);
      window.removeEventListener("online", now);
      window.removeEventListener(SYNC_EVENT, now);
    };
  }, []);

  const pending = offline.entries.length;
  useEffect(() => {
    if (online && offline.loaded && pending > 0 && !offline.syncing) flushRef.current();
  }, [online, offline.loaded, pending, offline.syncing]);

  return null;
}
