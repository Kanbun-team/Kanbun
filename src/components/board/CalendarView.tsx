"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { intlLocale, t, type Locale } from "@/lib/i18n";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import {
  cardsByDay,
  dateKey,
  inMonth,
  keyToUtcDate,
  monthGrid,
  monthOf,
  shiftMonth,
  type Month,
} from "@/lib/board-views";
import type { CardDTO } from "./types";

const VISIBLE_PER_DAY = 3;

function capitalize(text: string, locale: Locale) {
  return text.charAt(0).toLocaleUpperCase(intlLocale(locale)) + text.slice(1);
}

// Cards by deadline on a month grid (weeks start on Monday, see
// monthGrid). Phones get an agenda list of the month's days instead.
export default function CalendarView({
  boardId,
  cards,
  locale,
  noDeadlineHref,
  onShowNoDeadline,
}: {
  boardId: string;
  /** Cards that pass the current filters, in board order. */
  cards: CardDTO[];
  locale: Locale;
  noDeadlineHref: string;
  onShowNoDeadline: () => void;
}) {
  const [today] = useState(() => dateKey(new Date()));
  const [month, setMonth] = useState<Month>(() => monthOf(today));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byDay = useMemo(() => cardsByDay(cards), [cards]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const noDeadline = cards.filter((c) => !c.deadline).length;

  const intl = intlLocale(locale);
  const fmt = useMemo(
    () => ({
      title: new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }),
      full: new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
      weekdayShort: new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" }),
      weekdayLong: new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }),
    }),
    [intl]
  );
  const title = capitalize(fmt.title.format(keyToUtcDate(weeks[1][0])), locale);
  const fullDate = (key: string) => capitalize(fmt.full.format(keyToUtcDate(key)), locale);
  const agendaDays = weeks.flat().filter((key) => inMonth(key, month) && byDay.has(key));

  function toggleDay(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function chip(card: CardDTO, key: string) {
    const late = key < today;
    return (
      <li key={card.id}>
        <Link
          href={`/tasks/${boardId}/cards/${card.id}`}
          scroll={false}
          className={cn(
            "block truncate rounded-control px-1.5 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
            late ? "bg-danger/10 text-danger hover:bg-danger/15" : "bg-accent-soft text-accent hover:bg-accent/15"
          )}
          title={card.title}
        >
          {late && <span className="sr-only">{t("cardOverdue", locale)}: </span>}
          {card.title}
        </Link>
      </li>
    );
  }

  return (
    <section aria-labelledby="calendar-title" className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 id="calendar-title" aria-live="polite" className="text-lg font-semibold min-w-[10rem]">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButtonClass()}
            aria-label={t("calendarPrev", locale)}
            title={t("calendarPrev", locale)}
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setMonth(monthOf(today))}>
            {t("calendarToday", locale)}
          </button>
          <button
            type="button"
            className={iconButtonClass()}
            aria-label={t("calendarNext", locale)}
            title={t("calendarNext", locale)}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
        {noDeadline > 0 && (
          <p className="text-sm text-ink-muted sm:ml-auto flex items-center gap-2">
            <span className="tabular-nums">{t("calendarNoDeadline", locale).replace("{count}", String(noDeadline))}</span>
            <a
              href={noDeadlineHref}
              className="text-accent underline underline-offset-2 hover:no-underline"
              onClick={(e) => {
                e.preventDefault();
                onShowNoDeadline();
              }}
            >
              {t("calendarShowInList", locale)}
            </a>
          </p>
        )}
      </div>

      {/* Collapsed table borders ignore border-radius, so the rounded frame is a
          wrapper and the table hides its own outer edge (border-hidden). */}
      <div className="hidden sm:block rounded-panel border border-line bg-surface overflow-hidden">
        <table className="w-full table-fixed border-collapse border-hidden">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {weeks[0].map((key) => (
                <th key={key} scope="col" className="px-2 py-1.5 text-left text-sm font-medium text-ink-muted border-b border-line">
                  <span aria-hidden>{capitalize(fmt.weekdayShort.format(keyToUtcDate(key)), locale)}</span>
                  <span className="sr-only">{capitalize(fmt.weekdayLong.format(keyToUtcDate(key)), locale)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((key) => {
                  const dayCards = byDay.get(key) ?? [];
                  const open = expanded.has(key);
                  const overflow = dayCards.length > VISIBLE_PER_DAY;
                  const shown = overflow && !open ? dayCards.slice(0, VISIBLE_PER_DAY - 1) : dayCards;
                  const isToday = key === today;
                  const outside = !inMonth(key, month);
                  return (
                    <td
                      key={key}
                      data-date={key}
                      aria-current={isToday ? "date" : undefined}
                      className={cn("align-top h-28 p-1.5 border border-line", outside && "bg-paper")}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center justify-center min-w-6 h-6 px-1 mb-1 rounded-full text-sm tabular-nums",
                          isToday ? "bg-accent text-accent-fg font-semibold" : outside ? "text-ink-muted" : "text-ink"
                        )}
                      >
                        <span aria-hidden>{Number(key.slice(8))}</span>
                        <span className="sr-only">{fullDate(key)}</span>
                      </span>
                      {dayCards.length > 0 && <ul className="space-y-0.5">{shown.map((card) => chip(card, key))}</ul>}
                      {overflow && (
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggleDay(key)}
                          className="mt-0.5 w-full text-left rounded-control px-1.5 py-0.5 text-xs font-medium text-ink-muted hover:text-ink hover:bg-ink/5"
                        >
                          {open
                            ? t("calendarLess", locale)
                            : t("calendarMore", locale).replace("{count}", String(dayCards.length - shown.length))}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden">
        {agendaDays.length === 0 ? (
          <p className="text-ink-muted px-1">{t("calendarEmptyMonth", locale)}</p>
        ) : (
          <ol className="space-y-3">
            {agendaDays.map((key) => (
              <li key={key} data-date={key} aria-current={key === today ? "date" : undefined}>
                <h3 className={cn("text-sm font-semibold mb-1", key === today ? "text-accent" : "text-ink-muted")}>{fullDate(key)}</h3>
                <ul className="space-y-1">
                  {(byDay.get(key) ?? []).map((card) => {
                    const late = key < today;
                    return (
                      <li key={card.id}>
                        <Link
                          href={`/tasks/${boardId}/cards/${card.id}`}
                          scroll={false}
                          className={cn(
                            "block rounded-card border border-line bg-raised shadow-card px-3 py-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            late && "text-danger"
                          )}
                        >
                          {late && <span className="sr-only">{t("cardOverdue", locale)}: </span>}
                          {card.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
