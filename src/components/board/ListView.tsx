"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Clock, Lock } from "lucide-react";
import Avatar from "@/components/Avatar";
import TagChip from "@/components/ui/TagChip";
import { cn } from "@/lib/utils";
import { formatDate, intlLocale, t, type DictKey, type Locale } from "@/lib/i18n";
import { priorityLabel } from "@/lib/labels";
import { relativeDeadline } from "@/lib/deadline";
import { sortRows, type ListRow, type SortDirection, type SortKey } from "@/lib/board-views";
import type { ColumnDTO } from "./types";

// Tags have no natural order, so that column is not sortable.
const HEADERS: [SortKey | null, DictKey, string][] = [
  ["title", "cardTitle", "min-w-[16rem]"],
  ["column", "listColumn", "min-w-[8rem]"],
  ["assignees", "cardAssignees", "min-w-[10rem]"],
  [null, "cardTags", "min-w-[8rem]"],
  ["priority", "cardPriority", "min-w-[6rem]"],
  ["deadline", "cardDeadline", "min-w-[8rem]"],
  ["subtasks", "cardSubtasks", "min-w-[6rem]"],
];

// Every card on the board (after filters) as a sortable table. Clicking a
// title opens the card in the side panel, like on the board.
export default function ListView({
  boardId,
  columns,
  locale,
  filtering,
}: {
  boardId: string;
  /** Columns holding only the cards that pass the current filters. */
  columns: ColumnDTO[];
  locale: Locale;
  filtering: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "column", direction: "ascending" });
  const rows = useMemo(() => {
    const all: ListRow[] = columns.flatMap((col, columnIndex) =>
      col.cards.map((card) => ({ card, columnName: col.name, columnIndex }))
    );
    return sortRows(all, sort.key, sort.direction, intlLocale(locale));
  }, [columns, sort, locale]);

  function toggle(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "ascending" ? "descending" : "ascending" }
        : { key, direction: "ascending" }
    );
  }

  if (rows.length === 0) {
    return filtering ? null : <p className="text-ink-muted px-1">{t("listEmpty", locale)}</p>;
  }

  return (
    <div
      role="region"
      aria-label={t("listCaption", locale)}
      tabIndex={0}
      className="relative -mx-4 sm:mx-0 overflow-x-auto bg-surface border-y sm:border border-line sm:rounded-panel outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <table className="w-full text-left text-base border-collapse">
        <caption className="sr-only">{t("listCaption", locale)}</caption>
        <thead>
          <tr className="border-b border-line">
            {HEADERS.map(([key, label, width]) => {
              if (!key) {
                return (
                  <th key={label} scope="col" className={cn("px-3.5 py-1.5 font-medium text-sm text-ink-muted whitespace-nowrap", width)}>
                    {t(label, locale)}
                  </th>
                );
              }
              const active = sort.key === key;
              const Icon = !active ? ArrowUpDown : sort.direction === "ascending" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={active ? sort.direction : "none"}
                  className={cn("px-2 py-1.5 font-medium text-sm text-ink-muted whitespace-nowrap", width)}
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-control px-1.5 py-1 hover:bg-ink/5 hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      active && "text-ink"
                    )}
                  >
                    {t(label, locale)}
                    <Icon size={14} aria-hidden className={active ? "" : "opacity-60"} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, columnName }) => {
            const deadline = card.deadline ? relativeDeadline(card.deadline, locale) : null;
            return (
              <tr key={card.id} data-card-id={card.id} className="border-b border-line last:border-b-0 hover:bg-ink/[0.03]">
                <td className="px-3.5 py-2 align-top">
                  <Link
                    href={`/tasks/${boardId}/cards/${card.id}`}
                    scroll={false}
                    className="font-medium hover:underline rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent break-words"
                  >
                    {card.title}
                  </Link>
                  {card.blockedByCount > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-control px-1.5 py-px text-xs font-medium bg-danger/10 text-danger align-middle">
                      <Lock size={12} aria-hidden />
                      {t("cardBlocked", locale)}
                    </span>
                  )}
                </td>
                <td className="px-3.5 py-2 align-top text-ink-muted whitespace-nowrap">{columnName}</td>
                <td className="px-3.5 py-2 align-top">
                  {card.assignees.length > 0 && (
                    <span className="flex items-center gap-2">
                      <span className="flex -space-x-1.5 shrink-0" aria-hidden>
                        {card.assignees.slice(0, 3).map((u) => (
                          <Avatar key={u.id} src={u.avatarUrl} name={u.displayName ?? u.username} size={22} className="rounded-full ring-2 ring-surface" />
                        ))}
                      </span>
                      <span className="text-sm text-ink-muted truncate max-w-[12rem]">
                        {card.assignees.map((u) => u.displayName ?? u.username).join(", ")}
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-3.5 py-2 align-top">
                  {card.tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {card.tags.map((tag) => (
                        <TagChip key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-3.5 py-2 align-top whitespace-nowrap text-sm",
                    card.priority === "critical" ? "text-danger font-medium" : card.priority === "high" ? "text-warning font-medium" : "text-ink-muted"
                  )}
                >
                  {priorityLabel(card.priority, locale)}
                </td>
                <td className="px-3.5 py-2 align-top whitespace-nowrap text-sm tabular-nums">
                  {deadline ? (
                    <span
                      title={formatDate(new Date(card.deadline!), locale)}
                      className={cn(
                        "inline-flex items-center gap-1",
                        deadline.tone === "late" ? "text-danger font-medium" : deadline.tone === "soon" ? "text-warning font-medium" : "text-ink-muted"
                      )}
                    >
                      <Clock size={14} aria-hidden />
                      {deadline.tone === "late" && <span className="sr-only">{t("cardOverdue", locale)}: </span>}
                      {deadline.label}
                    </span>
                  ) : (
                    <span className="sr-only">{t("cardNoDeadline", locale)}</span>
                  )}
                </td>
                <td className="px-3.5 py-2 align-top whitespace-nowrap text-sm tabular-nums">
                  {card.subtasksTotal > 0 && (
                    <span className={card.subtasksDone === card.subtasksTotal ? "text-success" : "text-ink-muted"}>
                      <span aria-hidden>
                        {card.subtasksDone}/{card.subtasksTotal}
                      </span>
                      <span className="sr-only">
                        {t("cardSubtasksA11y", locale)
                          .replace("{done}", String(card.subtasksDone))
                          .replace("{total}", String(card.subtasksTotal))}
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
