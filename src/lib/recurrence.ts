import { intlLocale, t, type Locale } from "@/lib/i18n";

// Repeat rules for recurring cards. Client-safe and pure: dates are computed
// in the process's local time zone (the server's TZ for the job), so "every
// Monday at 09:00" means 09:00 on the server's clock.

export type RecurrenceRule =
  | { rule: "daily"; timeOfDay: string | null }
  | { rule: "weekly"; weekday: number; timeOfDay: string | null }
  | { rule: "monthly"; monthDay: number; timeOfDay: string | null };

export const RULE_KINDS = ["daily", "weekly", "monthly"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" -> [9, 30]; null or malformed means midnight. */
export function parseTimeOfDay(value: string | null | undefined): [number, number] {
  const m = value ? TIME_RE.exec(value) : null;
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

export function isTimeOfDay(value: string): boolean {
  return TIME_RE.test(value);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * The first run strictly after `after`. Monthly rules on a day the month does
 * not have (31 in April, 30 in February) run on that month's last day.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date {
  const [hh, mm] = parseTimeOfDay(rule.timeOfDay);
  const y = after.getFullYear();
  const mo = after.getMonth();
  const d = after.getDate();

  if (rule.rule === "daily") {
    const today = new Date(y, mo, d, hh, mm);
    return today > after ? today : new Date(y, mo, d + 1, hh, mm);
  }

  if (rule.rule === "weekly") {
    const offset = (rule.weekday - after.getDay() + 7) % 7;
    const candidate = new Date(y, mo, d + offset, hh, mm);
    return candidate > after ? candidate : new Date(y, mo, d + offset + 7, hh, mm);
  }

  for (let i = 0; i < 3; i++) {
    const year = y + Math.floor((mo + i) / 12);
    const month = (mo + i) % 12;
    const day = Math.min(rule.monthDay, daysInMonth(year, month));
    const candidate = new Date(year, month, day, hh, mm);
    if (candidate > after) return candidate;
  }
  // Unreachable: some month within the next three always qualifies.
  throw new Error("nextOccurrence: no candidate");
}

/** Builds a rule from loose input (form data, database row); null if invalid. */
export function toRule(input: {
  rule: string;
  weekday?: number | null;
  monthDay?: number | null;
  timeOfDay?: string | null;
}): RecurrenceRule | null {
  const timeOfDay = input.timeOfDay && isTimeOfDay(input.timeOfDay) ? input.timeOfDay : null;
  if (input.timeOfDay && !timeOfDay) return null;
  if (input.rule === "daily") return { rule: "daily", timeOfDay };
  if (input.rule === "weekly") {
    const w = input.weekday;
    if (w == null || !Number.isInteger(w) || w < 0 || w > 6) return null;
    return { rule: "weekly", weekday: w, timeOfDay };
  }
  if (input.rule === "monthly") {
    const md = input.monthDay;
    if (md == null || !Number.isInteger(md) || md < 1 || md > 31) return null;
    return { rule: "monthly", monthDay: md, timeOfDay };
  }
  return null;
}

/** Weekday names starting at Sunday (index 0), in the given locale. */
export function weekdayNames(locale: Locale): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", timeZone: "UTC" });
  // 2026-11-15 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 10, 15 + i))));
}

function ordinal(n: number, locale: Locale): string {
  if (locale === "en") {
    const rem10 = n % 10;
    const rem100 = n % 100;
    const suffix =
      rem100 >= 11 && rem100 <= 13 ? "th" : rem10 === 1 ? "st" : rem10 === 2 ? "nd" : rem10 === 3 ? "rd" : "th";
    return `${n}${suffix}`;
  }
  return locale === "it" ? String(n) : `${n}.`;
}

/** "Every Monday", "Monthly on the 1st at 09:00", "Every day". */
export function describeRule(rule: RecurrenceRule, locale: Locale): string {
  let text: string;
  if (rule.rule === "daily") text = t("repeatSummaryDaily", locale);
  else if (rule.rule === "weekly") {
    text = t("repeatSummaryWeekly", locale).replace("{weekday}", weekdayNames(locale)[rule.weekday]);
  } else {
    text = t("repeatSummaryMonthly", locale).replace("{day}", ordinal(rule.monthDay, locale));
  }
  if (rule.timeOfDay) text += " " + t("repeatSummaryAt", locale).replace("{time}", rule.timeOfDay);
  return text;
}
