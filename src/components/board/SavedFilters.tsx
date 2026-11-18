"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { sameFilters, type Filters } from "@/lib/board-filters";
import { createSavedFilterAction, deleteSavedFilterAction, renameSavedFilterAction } from "@/server/saved-filter-actions";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import type { SavedFilterDTO } from "./types";

// Named filters shared with the whole board, inside the filter popover.
export default function SavedFilters({
  boardId,
  saved,
  filters,
  filtering,
  setFilters,
  locale,
}: {
  boardId: string;
  saved: SavedFilterDTO[];
  filters: Filters;
  filtering: boolean;
  setFilters: (next: Filters) => void;
  locale: Locale;
}) {
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ui = useUi();
  const router = useRouter();
  const fill = (key: Parameters<typeof t>[0], name: string) => t(key, locale).replaceAll("{name}", name);

  async function save(name: string) {
    setBusy(true);
    const result = ui.report(await createSavedFilterAction({ boardId, name, filters }));
    setBusy(false);
    if (!result.ok) return;
    setNaming(false);
    ui.toast({ message: fill("savedFilterSaved", name) });
    router.refresh();
  }

  /** Back on the row's rename button, which the rename form replaced. */
  function focusRename(id: string) {
    requestAnimationFrame(() => document.getElementById(`saved-filter-rename-${id}`)?.focus());
  }

  async function rename(item: SavedFilterDTO, name: string) {
    if (name !== item.name) {
      setBusy(true);
      const result = ui.report(await renameSavedFilterAction({ id: item.id, name }));
      setBusy(false);
      if (!result.ok) return;
      ui.toast({ message: fill("savedFilterRenamed", name) });
      router.refresh();
    }
    setRenaming(null);
    focusRename(item.id);
  }

  async function remove(item: SavedFilterDTO) {
    const ok = await ui.confirm({
      title: fill("savedFilterDeleteTitle", item.name),
      body: t("savedFilterDeleteBody", locale),
      confirmLabel: t("delete", locale),
      danger: true,
    });
    if (!ok) return;
    if (ui.report(await deleteSavedFilterAction({ id: item.id })).ok) {
      ui.toast({ message: t("savedFilterDeleted", locale) });
      router.refresh();
    }
  }

  if (saved.length === 0 && !filtering) return null;

  return (
    <div className="pt-2 border-t border-line space-y-1.5">
      {saved.length > 0 && (
        <>
          <h3 id="saved-filters-heading" className="text-sm font-medium text-ink-muted">
            {t("savedFilters", locale)}
          </h3>
          <ul aria-labelledby="saved-filters-heading" className="space-y-0.5">
            {saved.map((item) => {
              const active = sameFilters(item.filters, filters);
              if (renaming === item.id) {
                return (
                  <li key={item.id}>
                    <form
                      className="flex gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
                        if (name && !busy) rename(item, name);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setRenaming(null);
                          focusRename(item.id);
                        }
                      }}
                    >
                      <input
                        name="name"
                        required
                        maxLength={60}
                        autoFocus
                        defaultValue={item.name}
                        onFocus={(e) => e.currentTarget.select()}
                        aria-label={t("savedFilterName", locale)}
                        className="!py-1 !text-sm flex-1 min-w-0"
                      />
                      <button className={buttonClass("primary", "sm")} disabled={busy}>
                        {t("save", locale)}
                      </button>
                    </form>
                  </li>
                );
              }
              return (
                <li key={item.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilters(item.filters)}
                    className={cn(
                      "flex-1 min-w-0 flex items-center gap-2 rounded-control px-2 py-1 text-left text-sm",
                      active ? "bg-accent-soft text-accent font-medium" : "hover:bg-ink/5"
                    )}
                  >
                    <Bookmark size={14} aria-hidden className="shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </button>
                  {item.canDelete && (
                    <button
                      type="button"
                      id={`saved-filter-rename-${item.id}`}
                      className={iconButtonClass("w-7 h-7 shrink-0")}
                      aria-label={fill("savedFilterRename", item.name)}
                      title={fill("savedFilterRename", item.name)}
                      onClick={() => setRenaming(item.id)}
                    >
                      <Pencil size={14} aria-hidden />
                    </button>
                  )}
                  {item.canDelete && (
                    <button
                      type="button"
                      className={iconButtonClass("w-7 h-7 shrink-0 hover:text-danger")}
                      aria-label={fill("savedFilterDelete", item.name)}
                      title={fill("savedFilterDelete", item.name)}
                      onClick={() => remove(item)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {filtering &&
        (naming ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              if (name && !busy) save(name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setNaming(false);
              }
            }}
          >
            <input
              name="name"
              required
              maxLength={60}
              autoFocus
              aria-label={t("savedFilterName", locale)}
              placeholder={t("savedFilterName", locale)}
              className="!py-1 !text-sm flex-1 min-w-0"
            />
            <button className={buttonClass("primary", "sm")} disabled={busy}>
              {t("save", locale)}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className={buttonClass("ghost", "sm", "w-full")}
            onClick={() => setNaming(true)}
          >
            <Bookmark size={14} aria-hidden />
            {t("savedFilterSave", locale)}
          </button>
        ))}
    </div>
  );
}
