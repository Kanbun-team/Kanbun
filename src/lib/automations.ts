import { z } from "zod";
import { t, tn, type Locale } from "@/lib/i18n";
import { PRIORITIES, priorityLabel } from "@/lib/labels";

// Board automations: rules of the form "when <trigger>, do <actions>".
// Client-safe (no Prisma): the schemas, the planner that works out what a
// rule changes on a card, and the plain-language description. Running rules
// and undoing their changes is in src/server/automations.ts.

export const AUTOMATION_TRIGGERS = ["cardEntersColumn", "deadlinePassed"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const ACTION_TYPES = [
  "assign",
  "unassignAll",
  "addTag",
  "removeTag",
  "setPriority",
  "setDeadline",
  "clearDeadline",
  "completeChecklist",
  "moveToColumn",
] as const;
export type AutomationActionType = (typeof ACTION_TYPES)[number];

/** Which actions a trigger offers. */
export const ACTIONS_FOR_TRIGGER: Record<AutomationTrigger, readonly AutomationActionType[]> = {
  cardEntersColumn: [
    "assign",
    "unassignAll",
    "addTag",
    "removeTag",
    "setPriority",
    "setDeadline",
    "clearDeadline",
    "completeChecklist",
  ],
  deadlinePassed: ["moveToColumn", "addTag"],
};

export const MAX_RULES_PER_BOARD = 50;
export const MAX_ACTIONS_PER_RULE = 10;
export const MAX_DEADLINE_DAYS = 365;
/**
 * How deep a chain of rules may go. A user's move runs the rules of the
 * column at depth 1; a move made by a rule runs the rules of its column at
 * the next depth, and nothing runs past this one. So a rule's own move
 * triggers the column rules once more, never in a loop.
 */
export const MAX_RULE_DEPTH = 2;

const id = z.string().min(1).max(64);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), userIds: z.array(id).min(1).max(20) }),
  z.object({ type: z.literal("unassignAll") }),
  z.object({ type: z.literal("addTag"), tagId: id }),
  z.object({ type: z.literal("removeTag"), tagId: id }),
  z.object({ type: z.literal("setPriority"), priority: z.enum(PRIORITIES) }),
  z.object({ type: z.literal("setDeadline"), days: z.number().int().min(0).max(MAX_DEADLINE_DAYS) }),
  z.object({ type: z.literal("clearDeadline") }),
  z.object({ type: z.literal("completeChecklist") }),
  z.object({ type: z.literal("moveToColumn"), columnId: id }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

/** A rule as saved: the trigger's own actions only, at least one. */
export const automationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    columnId: id.nullable().optional(),
    actions: z.array(automationActionSchema).min(1).max(MAX_ACTIONS_PER_RULE),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    if (rule.trigger === "cardEntersColumn" && !rule.columnId) {
      ctx.addIssue({ code: "custom", path: ["columnId"], message: "Pick the column" });
    }
    const allowed = ACTIONS_FOR_TRIGGER[rule.trigger];
    rule.actions.forEach((a, i) => {
      if (!allowed.includes(a.type)) {
        ctx.addIssue({ code: "custom", path: ["actions", i], message: `"${a.type}" does not fit this trigger` });
      }
    });
  })
  .transform((rule) => ({ ...rule, columnId: rule.trigger === "cardEntersColumn" ? rule.columnId! : null }));
export type AutomationRuleInput = z.input<typeof automationRuleInputSchema>;
export type AutomationRuleData = z.output<typeof automationRuleInputSchema>;

/** Stored actions (a JSON array); anything unreadable is dropped. */
export function parseActions(raw: string | null | undefined): AutomationAction[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    const parsed = automationActionSchema.safeParse(a);
    return parsed.success ? [parsed.data] : [];
  });
}

export function isAutomationTrigger(value: string): value is AutomationTrigger {
  return (AUTOMATION_TRIGGERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Planning: what a rule changes on a card
// ---------------------------------------------------------------------------

/** The parts of a card the actions read and change. Deadlines are ISO strings. */
export interface CardState {
  columnId: string;
  priority: string;
  deadline: string | null;
  assigneeIds: string[];
  tagIds: string[];
  /** Checklist items not done yet. */
  openSubtaskIds: string[];
}

/** What is on the board right now; actions naming anything else do nothing. */
export interface PlanContext {
  now: Date;
  /** Active board members (deactivated users can not be assigned). */
  memberIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  columnIds: ReadonlySet<string>;
}

/**
 * One change a rule made. Stored with the run (AutomationRun.changes) and
 * reverted, newest first, by "Undo".
 */
export type AutomationChange =
  | { kind: "assigneeAdd"; userId: string }
  | { kind: "assigneeRemove"; userId: string }
  | { kind: "tagAdd"; tagId: string }
  | { kind: "tagRemove"; tagId: string }
  | { kind: "priority"; from: string; to: string }
  | { kind: "deadline"; from: string | null; to: string | null }
  | { kind: "checklistDone"; subtaskIds: string[] }
  | { kind: "move"; fromColumnId: string; toColumnId: string; fromPosition?: number };

const DAY = 24 * 60 * 60 * 1000;

/** Today + `days` as a deadline: a calendar date at UTC midnight, like the UI stores. */
export function deadlineInDays(now: Date, days: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString();
}

/** True once the whole deadline day (UTC) is over, like "overdue" on the board. */
export function deadlinePassed(deadline: Date, now: Date): boolean {
  return now.getTime() >= deadline.getTime() + DAY;
}

/**
 * Works out what `actions` change on a card, in order, without touching the
 * database. Actions that would change nothing (a tag the card already has, a
 * user who left the board) are skipped. Returns the changes and the card as
 * it is afterwards, so the next rule in a chain sees the result.
 */
export function planActions(
  card: CardState,
  actions: readonly AutomationAction[],
  ctx: PlanContext
): { changes: AutomationChange[]; card: CardState } {
  const state: CardState = {
    ...card,
    assigneeIds: [...card.assigneeIds],
    tagIds: [...card.tagIds],
    openSubtaskIds: [...card.openSubtaskIds],
  };
  const changes: AutomationChange[] = [];
  for (const action of actions) {
    switch (action.type) {
      case "assign":
        for (const userId of action.userIds) {
          if (!ctx.memberIds.has(userId) || state.assigneeIds.includes(userId)) continue;
          state.assigneeIds.push(userId);
          changes.push({ kind: "assigneeAdd", userId });
        }
        break;
      case "unassignAll":
        for (const userId of state.assigneeIds) changes.push({ kind: "assigneeRemove", userId });
        state.assigneeIds = [];
        break;
      case "addTag":
        if (ctx.tagIds.has(action.tagId) && !state.tagIds.includes(action.tagId)) {
          state.tagIds.push(action.tagId);
          changes.push({ kind: "tagAdd", tagId: action.tagId });
        }
        break;
      case "removeTag":
        if (state.tagIds.includes(action.tagId)) {
          state.tagIds = state.tagIds.filter((x) => x !== action.tagId);
          changes.push({ kind: "tagRemove", tagId: action.tagId });
        }
        break;
      case "setPriority":
        if (state.priority !== action.priority) {
          changes.push({ kind: "priority", from: state.priority, to: action.priority });
          state.priority = action.priority;
        }
        break;
      case "setDeadline": {
        const to = deadlineInDays(ctx.now, action.days);
        if (state.deadline !== to) {
          changes.push({ kind: "deadline", from: state.deadline, to });
          state.deadline = to;
        }
        break;
      }
      case "clearDeadline":
        if (state.deadline !== null) {
          changes.push({ kind: "deadline", from: state.deadline, to: null });
          state.deadline = null;
        }
        break;
      case "completeChecklist":
        if (state.openSubtaskIds.length > 0) {
          changes.push({ kind: "checklistDone", subtaskIds: state.openSubtaskIds });
          state.openSubtaskIds = [];
        }
        break;
      case "moveToColumn":
        if (ctx.columnIds.has(action.columnId) && state.columnId !== action.columnId) {
          changes.push({ kind: "move", fromColumnId: state.columnId, toColumnId: action.columnId });
          state.columnId = action.columnId;
        }
        break;
    }
  }
  return { changes, card: state };
}

// ---------------------------------------------------------------------------
// Plain language
// ---------------------------------------------------------------------------

/** Names for the ids a rule mentions. */
export interface RuleNames {
  columns: ReadonlyMap<string, string>;
  tags: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m));
}

/** "add tag Blocked", "set the deadline to today + 3 days". */
export function describeAction(action: AutomationAction, names: RuleNames, locale: Locale): string {
  const column = (id: string) => names.columns.get(id) ?? t("automationMissingColumn", locale);
  const tag = (id: string) => names.tags.get(id) ?? t("automationMissingTag", locale);
  switch (action.type) {
    case "assign": {
      const people = action.userIds.map((id) => names.users.get(id) ?? t("deletedUser", locale));
      return fill(t("automationActionAssign", locale), { names: people.join(", ") });
    }
    case "unassignAll":
      return t("automationActionUnassignAll", locale);
    case "addTag":
      return fill(t("automationActionAddTag", locale), { tag: tag(action.tagId) });
    case "removeTag":
      return fill(t("automationActionRemoveTag", locale), { tag: tag(action.tagId) });
    case "setPriority":
      return fill(t("automationActionPriority", locale), { priority: priorityLabel(action.priority, locale) });
    case "setDeadline":
      return action.days === 0
        ? t("automationActionDeadlineToday", locale)
        : tn("automationActionDeadline", action.days, locale);
    case "clearDeadline":
      return t("automationActionClearDeadline", locale);
    case "completeChecklist":
      return t("automationActionChecklist", locale);
    case "moveToColumn":
      return fill(t("automationActionMove", locale), { column: column(action.columnId) });
  }
}

/** "When a card enters Done". */
export function describeTrigger(trigger: string, columnId: string | null, names: RuleNames, locale: Locale): string {
  if (trigger === "deadlinePassed") return t("automationWhenDeadline", locale);
  const column = (columnId && names.columns.get(columnId)) || t("automationMissingColumn", locale);
  return fill(t("automationWhenEnters", locale), { column });
}

/** "When a card enters Done: mark the checklist done, remove tag Blocked". */
export function describeRule(
  rule: { trigger: string; columnId: string | null; actions: readonly AutomationAction[] },
  names: RuleNames,
  locale: Locale
): string {
  return fill(t("automationSentence", locale), {
    trigger: describeTrigger(rule.trigger, rule.columnId, names, locale),
    actions: rule.actions.map((a) => describeAction(a, names, locale)).join(", "),
  });
}

// ---------------------------------------------------------------------------
// Board export (docs/IMPORT-EXPORT.md): names instead of ids
// ---------------------------------------------------------------------------

/** A rule as it appears in a Kanbun export file. */
export interface ExportedAutomation {
  name: string;
  enabled: boolean;
  trigger: string;
  column: string | null;
  actions: ({ type: string } & Record<string, unknown>)[];
}

/** Names a rule's ids for the export; ids with no name left are dropped. */
export function automationToExport(
  rule: { name: string; enabled: boolean; trigger: string; columnId: string | null; actions: readonly AutomationAction[] },
  names: RuleNames
): ExportedAutomation {
  const actions = rule.actions.flatMap((a): ExportedAutomation["actions"] => {
    switch (a.type) {
      case "assign": {
        const users = a.userIds.map((id) => names.users.get(id)).filter((n): n is string => !!n);
        return users.length ? [{ type: a.type, users }] : [];
      }
      case "addTag":
      case "removeTag": {
        const tag = names.tags.get(a.tagId);
        return tag ? [{ type: a.type, tag }] : [];
      }
      case "moveToColumn": {
        const column = names.columns.get(a.columnId);
        return column ? [{ type: a.type, column }] : [];
      }
      default:
        return [{ ...a }];
    }
  });
  return {
    name: rule.name,
    enabled: rule.enabled,
    trigger: rule.trigger,
    column: rule.columnId ? (names.columns.get(rule.columnId) ?? null) : null,
    actions,
  };
}

/**
 * Turns a rule from an export file back into ids on the new board. Unknown
 * action types and names that do not resolve are dropped; a rule left
 * without its column or without any action is skipped (null).
 */
export function automationFromExport(
  exp: ExportedAutomation,
  lookup: { column: (name: string) => string | undefined; tag: (name: string) => string | undefined; user: (username: string) => string | undefined }
): AutomationRuleData | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const actions = exp.actions.flatMap((a): unknown[] => {
    switch (a.type) {
      case "assign": {
        const list = Array.isArray(a.users) ? a.users : [];
        const userIds = list.map((u) => lookup.user(str(u))).filter((id): id is string => !!id);
        return userIds.length ? [{ type: "assign", userIds: [...new Set(userIds)] }] : [];
      }
      case "addTag":
      case "removeTag": {
        const tagId = lookup.tag(str(a.tag));
        return tagId ? [{ type: a.type, tagId }] : [];
      }
      case "moveToColumn": {
        const columnId = lookup.column(str(a.column));
        return columnId ? [{ type: a.type, columnId }] : [];
      }
      default: {
        const parsed = automationActionSchema.safeParse(a);
        return parsed.success ? [parsed.data] : [];
      }
    }
  });
  const parsed = automationRuleInputSchema.safeParse({
    name: exp.name,
    enabled: exp.enabled,
    trigger: exp.trigger,
    columnId: exp.column ? (lookup.column(exp.column) ?? null) : null,
    actions,
  });
  return parsed.success ? parsed.data : null;
}

/** A rule run set off by the client's own action, so it can offer "Undo". */
export interface RuleRunNotice {
  runId: string;
  ruleName: string;
}
