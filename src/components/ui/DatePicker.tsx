"use client";

import { useState, type RefObject } from "react";
import { Dialog, Heading, Popover } from "react-aria-components";
import { intlLocale, t, type Locale } from "@/lib/i18n";
import { keyToUtcDate, quickPickDate, type QuickPick } from "@/lib/board-views";
import { buttonClass } from "@/components/ui/button";

// Shared date picker (DESIGN.md section 5): a popover with the quick picks
// Today, Tomorrow, Next week and Clear, plus a native date input for any other
// day. Values are calendar dates as "YYYY-MM-DD" (null clears). Quick picks
// show their date in the user's locale.

const PICKS: [QuickPick, "dateToday" | "dateTomorrow" | "dateNextWeek"][] = [
  ["today", "dateToday"],
  ["tomorrow", "dateTomorrow"],
  ["nextWeek", "dateNextWeek"],
];

export function DatePickerPopover({
  triggerRef,
  isOpen,
  onOpenChange,
  title,
  value,
  onChange,
  locale,
}: {
  /** Element the popover is anchored to. */
  triggerRef: RefObject<Element | null>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: string | null;
  onChange: (value: string | null) => void;
  locale: Locale;
}) {
  return (
    <Popover
      triggerRef={triggerRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="bottom start"
      className="w-64 rounded-panel border border-line bg-raised text-ink shadow-float outline-none"
    >
      <Dialog aria-label={title} className="p-3 outline-none">
        <PickerBody
          title={title}
          value={value}
          locale={locale}
          onPick={(next) => {
            onOpenChange(false);
            if (next !== value) onChange(next);
          }}
        />
      </Dialog>
    </Popover>
  );
}

function PickerBody({
  title,
  value,
  locale,
  onPick,
}: {
  title: string;
  value: string | null;
  locale: Locale;
  onPick: (value: string | null) => void;
}) {
  // Mounted only while the popover is open, so "today" is fresh each time.
  const [now] = useState(() => new Date());
  const [draft, setDraft] = useState(value ?? "");
  const short = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <>
      <Heading slot="title" className="text-sm font-semibold mb-2 break-words">
        {title}
      </Heading>
      <div className="grid gap-0.5">
        {PICKS.map(([pick, label], i) => {
          const key = quickPickDate(pick, now);
          return (
            <button
              key={pick}
              type="button"
              autoFocus={i === 0}
              aria-pressed={value === key}
              onClick={() => onPick(key)}
              className="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left hover:bg-ink/5 aria-pressed:bg-accent-soft outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span>{t(label, locale)}</span>
              <span className="text-sm text-ink-muted tabular-nums">{short.format(keyToUtcDate(key))}</span>
            </button>
          );
        })}
        {value && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="rounded-control px-2 py-1.5 text-left hover:bg-ink/5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("dateClear", locale)}
          </button>
        )}
      </div>
      <form
        className="mt-2 pt-2 border-t border-line flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4}-\d{2}-\d{2}$/.test(draft)) onPick(draft);
        }}
      >
        <label className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-ink-muted mb-1">{t("dateCustom", locale)}</span>
          <input
            type="date"
            lang={intlLocale(locale)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="!py-1 !text-sm w-full"
          />
        </label>
        <button className={buttonClass("primary", "sm")} disabled={!draft}>
          {t("dateApply", locale)}
        </button>
      </form>
    </>
  );
}
