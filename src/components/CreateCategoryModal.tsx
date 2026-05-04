"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import ColorPicker from "./ColorPicker";
import { createBoardCategoryAction } from "@/server/tasks-actions";
import { t, type Locale } from "@/lib/i18n";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 font-medium disabled:opacity-60 flex items-center gap-2"
    >
      {pending && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
      )}
      {label}
    </button>
  );
}

export default function CreateCategoryModal({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition opacity-60 hover:opacity-100 px-4 py-3 text-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="font-medium">{t("categoryCreate", locale)}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md surface border rounded-2xl shadow-2xl">
            <form
              action={async (fd) => {
                await createBoardCategoryAction(fd);
                setOpen(false);
              }}
              className="flex flex-col"
            >
              <header className="flex items-center justify-between p-4 border-b border-[var(--border)]">
                <h2 className="font-semibold">{t("categoryCreate", locale)}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("close", locale)}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              </header>

              <div className="p-4 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium opacity-80">{t("categoryName", locale)}</span>
                  <input name="name" required maxLength={80} autoFocus className="mt-1.5" />
                </label>
                <div>
                  <span className="text-sm font-medium opacity-80 block mb-1.5">
                    {t("boardColor", locale)}
                  </span>
                  <ColorPicker name="color" defaultValue="#64748b" />
                </div>
              </div>

              <footer className="flex items-center justify-end gap-2 p-4 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-[var(--border)] hover:bg-slate-100 dark:hover:bg-slate-800 text-sm px-4 py-2"
                >
                  {t("cancel", locale)}
                </button>
                <SubmitButton label={t("create", locale)} />
              </footer>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
