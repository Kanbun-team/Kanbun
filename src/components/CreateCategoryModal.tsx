"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { FolderPlus } from "lucide-react";
import ColorPicker from "./ColorPicker";
import { createBoardCategoryAction } from "@/server/tasks-actions";
import { t, type Locale } from "@/lib/i18n";
import { useUi } from "./ui/UiProvider";
import { buttonClass, iconButtonClass } from "./ui/button";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass("primary", "lg", "disabled:opacity-60")}
    >
      {pending && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-accent-fg/70 border-t-transparent animate-spin" />
      )}
      {label}
    </button>
  );
}

export default function CreateCategoryModal({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const { report } = useUi();

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
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "md")}>
        <FolderPlus size={16} aria-hidden />
        {t("categoryCreate", locale)}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md bg-raised text-ink border border-line rounded-panel shadow-float">
            <form
              action={async (fd) => {
                if (report(await createBoardCategoryAction(fd)).ok) setOpen(false);
              }}
              className="flex flex-col"
            >
              <header className="flex items-center justify-between p-4 border-b border-line">
                <h2 className="text-lg font-semibold">{t("categoryCreate", locale)}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("close", locale)}
                  className={iconButtonClass()}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              </header>

              <div className="p-4 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-ink-muted">{t("categoryName", locale)}</span>
                  <input name="name" required maxLength={80} autoFocus className="mt-1.5" />
                </label>
                <div>
                  <span className="text-sm font-medium text-ink-muted block mb-1.5">
                    {t("boardColor", locale)}
                  </span>
                  <ColorPicker name="color" defaultValue="#64748b" />
                </div>
              </div>

              <footer className="flex items-center justify-end gap-2 p-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={buttonClass("secondary", "lg")}
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
