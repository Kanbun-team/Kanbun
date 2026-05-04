"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Avatar from "./Avatar";
import ColorPicker from "./ColorPicker";
import { createBoardAction } from "@/server/tasks-actions";
import { t, type Locale } from "@/lib/i18n";

interface UserOption {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  color: string;
}

interface Props {
  users: UserOption[];
  categories: CategoryOption[];
  defaultCategoryId?: string | null;
  locale: Locale;
  variant?: "button" | "card";
}

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

export default function CreateBoardModal({
  users,
  categories,
  defaultCategoryId = null,
  locale,
  variant = "button",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setSearch("");
    setSelected(new Set());
  }

  function toggleUser(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          (u.displayName ?? "").toLowerCase().includes(q)
      )
    : users;

  return (
    <>
      {variant === "card" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-full w-full min-h-[160px] flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition opacity-60 hover:opacity-100"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-sm font-medium">{t("boardCreate", locale)}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 font-medium"
        >
          + {t("boardCreate", locale)}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg surface border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <form action={createBoardAction} className="flex flex-col flex-1 min-h-0">
              <header className="flex items-center justify-between p-4 border-b border-[var(--border)]">
                <h2 className="font-semibold">{t("boardCreate", locale)}</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("close", locale)}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              </header>

              <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
                <label className="block">
                  <span className="text-sm font-medium opacity-80">{t("boardName", locale)}</span>
                  <input name="name" required maxLength={120} autoFocus className="mt-1.5" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium opacity-80">{t("boardDescription", locale)}</span>
                  <textarea name="description" maxLength={2000} rows={2} className="mt-1.5" />
                </label>

                <div>
                  <span className="text-sm font-medium opacity-80 block mb-1.5">
                    {t("boardColor", locale)}
                  </span>
                  <ColorPicker name="color" />
                </div>

                {categories.length > 0 && (
                  <label className="block">
                    <span className="text-sm font-medium opacity-80">
                      {t("boardCategory", locale)}
                    </span>
                    <select name="categoryId" defaultValue={defaultCategoryId ?? ""} className="mt-1.5">
                      <option value="">{t("boardCategoryNone", locale)}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium opacity-80">
                      {t("boardMembers", locale)}
                    </span>
                    <span className="text-xs opacity-60">
                      {selected.size === 0 ? t("optional", locale) : `${selected.size}`}
                    </span>
                  </div>
                  {users.length > 5 && (
                    <input
                      type="text"
                      placeholder={t("search", locale)}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="mb-2"
                    />
                  )}
                  <div className="max-h-56 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                    {users.length === 0 ? (
                      <div className="p-3 text-sm opacity-60 text-center">
                        {t("none", locale)}
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="p-3 text-sm opacity-60 text-center">
                        {t("noResults", locale)}
                      </div>
                    ) : (
                      filtered.map((u) => {
                        const isSel = selected.has(u.id);
                        return (
                          <label
                            key={u.id}
                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                              isSel
                                ? "bg-brand-50 dark:bg-brand-900/20"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                            }`}
                          >
                            <input
                              type="checkbox"
                              name="memberIds"
                              value={u.id}
                              checked={isSel}
                              onChange={() => toggleUser(u.id)}
                            />
                            <Avatar
                              src={u.avatarUrl}
                              name={u.displayName ?? u.username}
                              size={28}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {u.displayName ?? u.username}
                              </div>
                              <div className="text-xs opacity-60 truncate">@{u.username}</div>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <footer className="flex items-center justify-end gap-2 p-4 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={close}
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
