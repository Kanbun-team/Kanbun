import { intlLocale, t, tn, type DictKey, type Locale } from "@/lib/i18n";
import { priorityLabel } from "@/lib/labels";

// Card activity: the shapes stored in CardActivity.data and how each entry is
// described in the card timeline. Client-safe (no Prisma); the server helper
// that writes entries lives in src/server/activity.ts.

export type ActivityData = {
  created: { column: string };
  createdFromTemplate: { column: string; template: string };
  createdBySchedule: { column: string; template: string };
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
  subtaskConverted: { title: string };
  attachmentAdded: { name: string };
  attachmentRemoved: { name: string };
  checklistDone: { count: number };
  /** Not `rule`: that key marks entries made by a rule (activityRule). */
  automationUndone: { ruleName: string };
};

export type ActivityType = keyof ActivityData;

export type ActivityInput = {
  [K in ActivityType]: { type: K; data: ActivityData[K] };
}[ActivityType];

const TEMPLATES: Record<ActivityType, DictKey> = {
  created: "activityCreated",
  createdFromTemplate: "activityCreatedFromTemplate",
  createdBySchedule: "activityCreatedBySchedule",
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
  subtaskConverted: "activitySubtaskConverted",
  attachmentAdded: "activityAttachmentAdded",
  attachmentRemoved: "activityAttachmentRemoved",
  // Counted: describeActivity picks the plural form with tn().
  checklistDone: "activityChecklistDone_other",
  automationUndone: "activityAutomationUndone",
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
      case "createdFromTemplate":
      case "createdBySchedule":
        values = { column: str(data, "column"), template: str(data, "template") };
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
      case "attachmentAdded":
      case "attachmentRemoved":
        values = { name: str(data, "name") };
        break;
      case "blocked":
      case "unblocked":
      case "subtaskDone":
      case "subtaskConverted":
        values = { title: str(data, "title") };
        break;
      case "automationUndone":
        values = { rule: str(data, "ruleName") };
        break;
      default:
        break;
    }
  }
  const template =
    type === "checklistDone" ? tn("activityChecklistDone", Number(data.count) || 0, locale) : t(key, locale);
  const at = template.indexOf("{actor}");
  if (at === -1) return ["", " " + fill(template, values)];
  return [fill(template.slice(0, at), values), fill(template.slice(at + "{actor}".length), values)];
}

/**
 * The rule that made a change, when an automation made it: its name is
 * shown in place of the person ("Rule "Done cleanup" added tag Blocked").
 */
export function activityRule(data: Record<string, unknown>): { name: string; runId: string | null } | null {
  return typeof data.rule === "string" && data.rule
    ? { name: data.rule, runId: typeof data.runId === "string" ? data.runId : null }
    : null;
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
