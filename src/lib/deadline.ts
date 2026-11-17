import { intlLocale, type Locale } from "@/lib/i18n";

// Deadlines are calendar dates (stored as UTC midnight). The card face shows
// them relative to today: "Tomorrow", "In 3 days", "2 days ago" (late).
export type DeadlineTone = "late" | "soon" | "normal";

const DAY = 24 * 60 * 60 * 1000;

function dayNumber(year: number, month: number, day: number) {
  return Date.UTC(year, month, day) / DAY;
}

/** Whole days from today (local calendar) to the deadline's date. */
export function daysUntil(deadlineIso: string, now: Date = new Date()): number {
  const d = new Date(deadlineIso);
  const target = dayNumber(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round(target - today);
}

export function deadlineTone(days: number): DeadlineTone {
  if (days < 0) return "late";
  if (days <= 1) return "soon";
  return "normal";
}

export function relativeDeadline(deadlineIso: string, locale: Locale, now: Date = new Date()) {
  const days = daysUntil(deadlineIso, now);
  const text = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" }).format(days, "day");
  return { days, tone: deadlineTone(days), label: text.charAt(0).toLocaleUpperCase(intlLocale(locale)) + text.slice(1) };
}
