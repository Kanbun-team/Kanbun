"use client";

import { useEffect, useRef } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITIES, priorityLabel } from "@/lib/labels";
import { t, type Locale } from "@/lib/i18n";

export interface Filters {
  query: string;
  assigneeId: string;
  tagId: string;
  priority: string;
  deadline: "" | "overdue" | "has" | "none";
  mine: boolean;
}

export const EMPTY_FILTERS: Filters = {
  query: "",
  assigneeId: "",
  tagId: "",
  priority: "",
  deadline: "",
  mine: false,
};

export default function FilterBar({
  filters,
  setFilters,
  assigneeOptions,
  tagOptions,
  filtering,
  visibleCount,
  locale,
  open,
  setOpen,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  assigneeOptions: { id: string; name: string }[];
  tagOptions: { id: string; name: string }[];
  filtering: boolean;
  visibleCount: number;
  locale: Locale;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, setOpen]);

  const activeCount =
    (filters.query.trim() ? 1 : 0) +
    (filters.assigneeId ? 1 : 0) +
    (filters.tagId ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.deadline ? 1 : 0) +
    (filters.mine ? 1 : 0);

  const selectClass =
    "!py-1 !text-sm w-full rounded-control border border-line-strong bg-transparent";
  const fieldLabel = "block text-sm font-medium text-ink-muted mb-1";

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 rounded-control text-sm px-3 py-1.5 border transition",
          filtering
            ? "border-accent bg-accent-soft text-accent"
            : "border-line-strong text-ink-muted hover:text-ink hover:bg-ink/5"
        )}
      >
        <Filter size={16} aria-hidden />
        {t("filter", locale)}
        {activeCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-fg text-xs font-semibold tabular-nums flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-72 bg-raised border border-line rounded-panel shadow-float p-3 space-y-3">
          <div>
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder={t("filterSearchPlaceholder", locale)}
              aria-label={t("filterSearchPlaceholder", locale)}
              autoFocus
              className="!py-1 !text-sm w-full"
            />
          </div>
          <div>
            <label className={fieldLabel} aria-hidden>{t("filterAssignee", locale)}</label>
            <select
              aria-label={t("filterAssignee", locale)}
              value={filters.assigneeId}
              onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value, mine: false })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              {assigneeOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel} aria-hidden>{t("filterTag", locale)}</label>
            <select
              aria-label={t("filterTag", locale)}
              value={filters.tagId}
              onChange={(e) => setFilters({ ...filters, tagId: e.target.value })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              {tagOptions.map((tg) => (
                <option key={tg.id} value={tg.id}>{tg.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel} aria-hidden>{t("filterPriority", locale)}</label>
            <select
              aria-label={t("filterPriority", locale)}
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{priorityLabel(p, locale)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel} aria-hidden>{t("filterDeadline", locale)}</label>
            <select
              aria-label={t("filterDeadline", locale)}
              value={filters.deadline}
              onChange={(e) => setFilters({ ...filters, deadline: e.target.value as Filters["deadline"] })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              <option value="overdue">{t("cardOverdue", locale)}</option>
              <option value="has">{t("filterHasDeadline", locale)}</option>
              <option value="none">{t("cardNoDeadline", locale)}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setFilters({ ...filters, mine: !filters.mine, assigneeId: "" })}
            aria-pressed={filters.mine}
            className={cn(
              "w-full rounded-control text-sm px-2.5 py-1.5 border transition",
              filters.mine
                ? "bg-accent text-accent-fg border-transparent"
                : "border-line-strong text-ink-muted hover:text-ink hover:bg-ink/5"
            )}
          >
            {t("filterAssignedToMe", locale)}
          </button>
          {filtering && (
            <div className="flex items-center justify-between pt-1 border-t border-line">
              <span className="text-xs text-ink-muted tabular-nums">{visibleCount}</span>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-sm text-ink-muted hover:text-ink"
              >
                {t("filterClear", locale)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
