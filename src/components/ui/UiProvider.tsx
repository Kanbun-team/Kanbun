"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { X } from "lucide-react";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import type { ActionResult } from "@/lib/action-result";
import { buttonClass, iconButtonClass } from "./button";
import { cn } from "@/lib/utils";

// App-wide feedback: one toast at a time (bottom-left, announced to screen
// readers) and a promise-based confirm dialog that replaces window.confirm.

export interface ToastOptions {
  message: string;
  tone?: "default" | "error";
  action?: { label: string; onAction: () => void | Promise<void> };
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
}

interface UiApi {
  locale: Locale;
  toast: (options: ToastOptions) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Shows a translated error toast when the result failed. Returns the result. */
  report: <T>(result: ActionResult<T>) => ActionResult<T>;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}

export function errorMessage(code: string, locale: Locale): string {
  return t(`error_${code}` as DictKey, locale);
}

const TOAST_MS = 6000;

export default function UiProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [toastState, setToastState] = useState<(ToastOptions & { id: number }) | null>(null);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const nextId = useRef(0);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    setToastState({ ...options, id: nextId.current });
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setConfirmState({ ...options, resolve })),
    []
  );

  const report = useCallback(
    <T,>(result: ActionResult<T>) => {
      if (!result.ok) toast({ message: errorMessage(result.error, locale), tone: "error" });
      return result;
    },
    [locale, toast]
  );

  function closeConfirm(ok: boolean) {
    confirmState?.resolve(ok);
    setConfirmState(null);
  }

  return (
    <UiContext.Provider value={{ locale, toast, confirm, report }}>
      {children}
      <ToastView toast={toastState} locale={locale} onDismiss={() => setToastState(null)} />
      <ModalOverlay
        isOpen={confirmState !== null}
        onOpenChange={(open) => !open && closeConfirm(false)}
        isDismissable
        className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      >
        <Modal className="w-full max-w-md rounded-panel bg-raised text-ink shadow-float border border-line">
          <Dialog role="alertdialog" className="p-5 outline-none">
            <Heading slot="title" className="text-lg font-semibold">
              {confirmState?.title}
            </Heading>
            {confirmState?.body && <p className="mt-2 text-base text-ink-muted">{confirmState.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={buttonClass("secondary")} onClick={() => closeConfirm(false)}>
                {t("cancel", locale)}
              </button>
              <button
                type="button"
                autoFocus
                className={buttonClass(confirmState?.danger ? "danger" : "primary")}
                onClick={() => closeConfirm(true)}
              >
                {confirmState?.confirmLabel}
              </button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </UiContext.Provider>
  );
}

function ToastView({
  toast,
  locale,
  onDismiss,
}: {
  toast: (ToastOptions & { id: number }) | null;
  locale: Locale;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, paused, onDismiss]);

  // The live region stays mounted so screen readers announce each new toast.
  return (
    <div
      role="region"
      aria-label={t("toastRegion", locale)}
      className="fixed z-[90] left-4 right-4 sm:right-auto bottom-[calc(1rem+var(--safe-bottom))] pointer-events-none"
    >
      <div role={toast?.tone === "error" ? "alert" : "status"} aria-live={toast?.tone === "error" ? "assertive" : "polite"}>
        {toast && (
          <div
            key={toast.id}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            className={cn(
              "pointer-events-auto flex items-center gap-3 sm:max-w-md rounded-panel bg-ink text-paper shadow-float pl-4 pr-2 py-2 text-base",
              toast.tone === "error" && "border-l-4 border-danger"
            )}
          >
            <span className="flex-1 py-1">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="font-semibold px-2 py-1 rounded-control hover:bg-paper/15 underline-offset-2 hover:underline"
                onClick={async () => {
                  const action = toast.action!;
                  onDismiss();
                  await action.onAction();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className={iconButtonClass("text-paper/70 hover:text-paper hover:bg-paper/15")}
              aria-label={t("close", locale)}
              onClick={onDismiss}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
