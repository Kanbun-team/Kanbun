import { intlLocale, t, type DictKey, type Locale } from "@/lib/i18n";
import { priorityLabel } from "@/lib/labels";

// Card activity: the shapes stored in CardActivity.data and how each entry is
// described in the card timeline. Client-safe (no Prisma); the server helper
// that writes entries lives in src/server/activity.ts.

export type ActivityData = {
  created: { column: string };
  moved: { from: string; to: string };
  renamed: { from: string; to: string };
  priority: { from: string; to: string };
  deadline: { to: string | null };
  description: Record<string, never>;
  assigneeAdded: { name: string };
  assigneeRemoved: { name: string };
  tagAdded: { name: string };
  tagRemoved: { name: string };
  blocked: { title: string };
  unblocked: { title: string };
  subtaskDone: { title: string };
};

export type ActivityType = keyof ActivityData;

export type ActivityInput = {
  [K in ActivityType]: { type: K; data: ActivityData[K] };
}[ActivityType];

const TEMPLATES: Record<ActivityType, DictKey> = {
  created: "activityCreated",
  moved: "activityMoved",
  renamed: "activityRenamed",
  priority: "activityPriority",
  deadline: "activityDeadlineSet",
  description: "activityDescription",
  assigneeAdded: "activityAssigneeAdded",
  assigneeRemoved: "activityAssigneeRemoved",
  tagAdded: "activityTagAdded",
  tagRemoved: "activityTagRemoved",
  blocked: "activityBlocked",
  unblocked: "activityUnblocked",
  subtaskDone: "activitySubtaskDone",
};

export function isActivityType(value: string): value is ActivityType {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

/** Parse a stored data column; anything malformed becomes an empty object. */
export function parseActivityData(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

function formatDeadline(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Deadlines are calendar dates stored as UTC midnight.
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m));
}

/**
 * The entry as text split around the actor, so the UI can set the name in
 * bold: ["", " moved this card from To do to Review"] means the actor comes
 * first. Values are filled after splitting, so a card title that happens to
 * contain "{actor}" stays literal.
 */
export function describeActivity(
  type: string,
  data: Record<string, unknown>,
  locale: Locale
): [before: string, after: string] {
  let key: DictKey;
  let values: Record<string, string> = {};
  if (!isActivityType(type)) {
    key = "activityUnknown";
  } else {
    key = TEMPLATES[type];
    switch (type) {
      case "created":
        values = { column: str(data, "column") };
        break;
      case "moved":
      case "renamed":
        values = { from: str(data, "from"), to: str(data, "to") };
        break;
      case "priority":
        values = {
          from: priorityLabel(str(data, "from"), locale),
          to: priorityLabel(str(data, "to"), locale),
        };
        break;
      case "deadline": {
        const to = str(data, "to");
        if (to) values = { date: formatDeadline(to, locale) };
        else key = "activityDeadlineCleared";
        break;
      }
      case "assigneeAdded":
      case "assigneeRemoved":
      case "tagAdded":
      case "tagRemoved":
        values = { name: str(data, "name") };
        break;
      case "blocked":
      case "unblocked":
      case "subtaskDone":
        values = { title: str(data, "title") };
        break;
      default:
        break;
    }
  }
  const template = t(key, locale);
  const at = template.indexOf("{actor}");
  if (at === -1) return ["", " " + fill(template, values)];
  return [fill(template.slice(0, at), values), fill(template.slice(at + "{actor}".length), values)];
}

/** The whole entry as plain text, e.g. for tests and screen reader labels. */
export function formatActivity(type: string, data: Record<string, unknown>, actor: string, locale: Locale): string {
  const [before, after] = describeActivity(type, data, locale);
  return `${before}${actor}${after}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "Just now", "5 minutes ago", "Yesterday", "3 weeks ago". */
export function relativeTime(date: Date, now: Date, locale: Locale): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  let text: string;
  if (Math.abs(seconds) < 45) {
    text = rtf.format(0, "second");
  } else {
    const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ["minute", 60];
    text = rtf.format(Math.round(seconds / size), unit);
  }
  return text.charAt(0).toLocaleUpperCase(intlLocale(locale)) + text.slice(1);
}
