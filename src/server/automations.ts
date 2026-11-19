// Runs board automation rules (src/lib/automations.ts) and undoes them.
// Server-only, not a "use server" module.
//
// - runEnterColumnRules(): called inside the transaction of every operation
//   that puts a card into a column (a move from anywhere, a new card, a card
//   from a template or a schedule), so the rule's changes commit or roll back
//   together with it.
// - runDeadlineRules(): the background job for "when the deadline passes".
// - undoAutomationRun(): reverts what one run changed.
// - publishRuleRuns(): webhooks and notifications, after the commit.
//
// Every change is written to the card history with the rule's name and the
// run id, and each run is kept as an AutomationRun row with its changes, which
// is what "Undo" reverts. Chains are bounded by MAX_RULE_DEPTH and a rule
// runs at most once per chain, so rules can never loop.

import type { Prisma, PrismaClient } from "@prisma/client";
import { isKnownRequestError, prisma } from "@/lib/db-local";
import {
  MAX_RULE_DEPTH,
  deadlinePassed,
  parseActions,
  planActions,
  type AutomationChange,
  type AutomationTrigger,
  type CardState,
  type PlanContext,
  type RuleRunNotice,
} from "@/lib/automations";
import { logActivity, type ActivityEntry } from "@/server/activity";
import { watchCard } from "@/server/watchers";

type Tx = Prisma.TransactionClient;

const DAY = 24 * 60 * 60 * 1000;

/** What one rule run did, for the effects after the commit and the undo toast. */
export interface RuleRun {
  runId: string;
  ruleId: string;
  ruleName: string;
  boardId: string;
  cardId: string;
  cardTitle: string;
  trigger: AutomationTrigger;
  /** The user whose action set the rule off; null for the deadline job. */
  actorId: string | null;
  changes: AutomationChange[];
  /** Card fields changed, as in the `changes` of the card.updated webhook. */
  fields: string[];
  move: { from: { columnId: string; columnName: string }; to: { columnId: string; columnName: string } } | null;
  /** Users the rule assigned (they get the "assigned" notification). */
  assigned: string[];
}

export function runNotices(runs: RuleRun[]): RuleRunNotice[] {
  return runs.filter((r) => r.changes.length > 0).map((r) => ({ runId: r.runId, ruleName: r.ruleName }));
}

interface RuleRow {
  id: string;
  name: string;
  actions: string;
}

/** The card and its board, as the planner and the history need them. */
interface Env {
  boardId: string;
  cardId: string;
  title: string;
  position: number;
  card: CardState;
  ctx: PlanContext;
  columns: Map<string, string>;
  tags: Map<string, string>;
  users: Map<string, string>;
}

async function loadEnv(tx: Tx, cardId: string, now: Date): Promise<Env | null> {
  const card = await tx.taskCard.findUnique({
    where: { id: cardId },
    select: {
      title: true,
      position: true,
      columnId: true,
      priority: true,
      deadline: true,
      column: { select: { boardId: true } },
      assignees: { select: { userId: true } },
      tags: { select: { tagId: true } },
      subtasks: { where: { done: false }, orderBy: { position: "asc" }, select: { id: true } },
    },
  });
  if (!card) return null;
  const boardId = card.column.boardId;
  const [columns, tags, members] = await Promise.all([
    tx.boardColumn.findMany({ where: { boardId }, select: { id: true, name: true } }),
    tx.boardTag.findMany({ where: { boardId }, select: { id: true, name: true } }),
    tx.boardMember.findMany({
      where: { boardId },
      select: { userId: true, user: { select: { username: true, displayName: true, deactivatedAt: true } } },
    }),
  ]);
  const users = new Map(members.map((m) => [m.userId, m.user.displayName ?? m.user.username]));
  // Assignees who are no longer members still need a name in the history.
  const others = card.assignees.map((a) => a.userId).filter((id) => !users.has(id));
  if (others.length) {
    const rows = await tx.user.findMany({ where: { id: { in: others } }, select: { id: true, username: true, displayName: true } });
    for (const u of rows) users.set(u.id, u.displayName ?? u.username);
  }
  return {
    boardId,
    cardId,
    title: card.title,
    position: card.position,
    card: {
      columnId: card.columnId,
      priority: card.priority,
      deadline: card.deadline ? card.deadline.toISOString() : null,
      assigneeIds: card.assignees.map((a) => a.userId),
      tagIds: card.tags.map((t) => t.tagId),
      openSubtaskIds: card.subtasks.map((s) => s.id),
    },
    ctx: {
      now,
      memberIds: new Set(members.filter((m) => !m.user.deactivatedAt).map((m) => m.userId)),
      tagIds: new Set(tags.map((t) => t.id)),
      columnIds: new Set(columns.map((c) => c.id)),
    },
    columns: new Map(columns.map((c) => [c.id, c.name])),
    tags: new Map(tags.map((t) => [t.id, t.name])),
    users,
  };
}

const FIELD_OF_CHANGE: Record<AutomationChange["kind"], string | null> = {
  assigneeAdd: "assignees",
  assigneeRemove: "assignees",
  tagAdd: "tags",
  tagRemove: "tags",
  priority: "priority",
  deadline: "deadline",
  checklistDone: "checklist",
  move: null,
};

function fieldsOf(changes: AutomationChange[]): string[] {
  return [...new Set(changes.map((c) => FIELD_OF_CHANGE[c.kind]).filter((f): f is string => !!f))];
}

/**
 * Writes `changes` to the card and the history. `rule` marks the history
 * entries as made by a rule; without it (an undo) they are the actor's own.
 */
async function writeChanges(
  tx: Tx,
  env: Env,
  changes: AutomationChange[],
  actorId: string | null,
  rule: { name: string; runId: string } | undefined
): Promise<void> {
  const base = { cardId: env.cardId, boardId: env.boardId, actorId, ...(rule ? { rule } : {}) };
  const entries: ActivityEntry[] = [];
  const fields: Prisma.TaskCardUncheckedUpdateInput = {};
  const userName = (id: string) => env.users.get(id) ?? "";
  const tagName = (id: string) => env.tags.get(id) ?? "";
  const now = new Date();
  for (const c of changes) {
    switch (c.kind) {
      case "assigneeAdd":
        await tx.taskCardAssignee.upsert({
          where: { cardId_userId: { cardId: env.cardId, userId: c.userId } },
          update: {},
          create: { cardId: env.cardId, userId: c.userId },
        });
        await watchCard(env.cardId, c.userId, tx);
        entries.push({ ...base, type: "assigneeAdded", data: { name: userName(c.userId) } });
        break;
      case "assigneeRemove":
        await tx.taskCardAssignee.deleteMany({ where: { cardId: env.cardId, userId: c.userId } });
        entries.push({ ...base, type: "assigneeRemoved", data: { name: userName(c.userId) } });
        break;
      case "tagAdd":
        await tx.taskCardTag.upsert({
          where: { cardId_tagId: { cardId: env.cardId, tagId: c.tagId } },
          update: {},
          create: { cardId: env.cardId, tagId: c.tagId },
        });
        entries.push({ ...base, type: "tagAdded", data: { name: tagName(c.tagId) } });
        break;
      case "tagRemove":
        await tx.taskCardTag.deleteMany({ where: { cardId: env.cardId, tagId: c.tagId } });
        entries.push({ ...base, type: "tagRemoved", data: { name: tagName(c.tagId) } });
        break;
      case "priority":
        fields.priority = c.to;
        entries.push({ ...base, type: "priority", data: { from: c.from, to: c.to } });
        break;
      case "deadline":
        fields.deadline = c.to ? new Date(c.to) : null;
        entries.push({ ...base, type: "deadline", data: { to: c.to } });
        break;
      case "checklistDone": {
        const done = await tx.taskSubtask.updateMany({
          where: { id: { in: c.subtaskIds }, cardId: env.cardId, done: false },
          data: { done: true, completedAt: now, completedById: actorId },
        });
        if (done.count > 0) entries.push({ ...base, type: "checklistDone", data: { count: done.count } });
        break;
      }
      case "move": {
        const last = await tx.taskCard.findFirst({
          where: { columnId: c.toColumnId, id: { not: env.cardId } },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        fields.columnId = c.toColumnId;
        fields.position = (last?.position ?? -1) + 1;
        const from = env.columns.get(c.fromColumnId) ?? "";
        const to = env.columns.get(c.toColumnId) ?? "";
        await tx.taskCardMoveEvent.create({
          data: { cardId: env.cardId, cardTitle: env.title, boardId: env.boardId, fromColumnName: from, toColumnName: to, userId: actorId },
        });
        entries.push({ ...base, type: "moved", data: { from, to, fromId: c.fromColumnId, toId: c.toColumnId } });
        env.card.columnId = c.toColumnId;
        break;
      }
    }
  }
  // Always touch the card, so API clients polling updatedSince see the change.
  await tx.taskCard.update({ where: { id: env.cardId }, data: { ...fields, updatedAt: now } });
  await logActivity(entries, tx);
}

/**
 * Plans and applies one rule. Returns null when it changes nothing (then
 * nothing is recorded), unless `dedupeKey` is set: the run row is then always
 * written, so a deadline is only handled once.
 */
async function applyRule(
  tx: Tx,
  env: Env,
  rule: RuleRow,
  opts: { trigger: AutomationTrigger; actorId: string | null; dedupeKey?: string }
): Promise<RuleRun | null> {
  const plan = planActions(env.card, parseActions(rule.actions), env.ctx);
  if (plan.changes.length === 0 && !opts.dedupeKey) return null;
  const changes = plan.changes.map((c) => (c.kind === "move" ? { ...c, fromPosition: env.position } : c));
  const row = await tx.automationRun.create({
    data: {
      ruleId: rule.id,
      ruleName: rule.name,
      boardId: env.boardId,
      cardId: env.cardId,
      trigger: opts.trigger,
      changes: JSON.stringify(changes),
      dedupeKey: opts.dedupeKey ?? null,
      actorId: opts.actorId,
    },
    select: { id: true },
  });
  const move = changes.find((c) => c.kind === "move");
  if (changes.length) await writeChanges(tx, env, changes, opts.actorId, { name: rule.name, runId: row.id });
  env.card = plan.card;
  return {
    runId: row.id,
    ruleId: rule.id,
    ruleName: rule.name,
    boardId: env.boardId,
    cardId: env.cardId,
    cardTitle: env.title,
    trigger: opts.trigger,
    actorId: opts.actorId,
    changes,
    fields: fieldsOf(changes),
    move:
      move && move.kind === "move"
        ? {
            from: { columnId: move.fromColumnId, columnName: env.columns.get(move.fromColumnId) ?? "" },
            to: { columnId: move.toColumnId, columnName: env.columns.get(move.toColumnId) ?? "" },
          }
        : null,
    assigned: changes.flatMap((c) => (c.kind === "assigneeAdd" ? [c.userId] : [])),
  };
}

export interface EnterColumnInput {
  cardId: string;
  boardId: string;
  columnId: string;
  /** Whose action put the card there (null for jobs). */
  actorId: string | null;
  now?: Date;
}

/**
 * Runs the enabled "when a card enters this column" rules of the board on a
 * card that was just moved into (or created in) `columnId`. Call it inside
 * the transaction of that move. `depth` and `fired` bound the chain: a move
 * made by a rule runs the rules of its new column at the next depth, up to
 * MAX_RULE_DEPTH, and no rule runs twice in one chain.
 */
export async function runEnterColumnRules(
  tx: Tx,
  input: EnterColumnInput,
  depth = 1,
  fired: Set<string> = new Set()
): Promise<RuleRun[]> {
  if (depth > MAX_RULE_DEPTH) return [];
  const rules = await tx.automationRule.findMany({
    where: { boardId: input.boardId, trigger: "cardEntersColumn", columnId: input.columnId, enabled: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, actions: true },
  });
  const pending = rules.filter((r) => !fired.has(r.id));
  if (pending.length === 0) return [];
  const env = await loadEnv(tx, input.cardId, input.now ?? new Date());
  if (!env || env.boardId !== input.boardId || env.card.columnId !== input.columnId) return [];
  const runs: RuleRun[] = [];
  for (const rule of pending) {
    fired.add(rule.id);
    const run = await applyRule(tx, env, rule, { trigger: "cardEntersColumn", actorId: input.actorId });
    if (!run) continue;
    runs.push(run);
    if (run.move) {
      // The card left this column: its other rules no longer apply, the new
      // column's do (one level deeper).
      runs.push(
        ...(await runEnterColumnRules(tx, { ...input, columnId: run.move.to.columnId }, depth + 1, fired))
      );
      break;
    }
  }
  return runs;
}

/** The dedupe key of a deadline run: one run per rule, card and deadline. */
export function deadlineRunKey(ruleId: string, cardId: string, deadline: Date): string {
  return `${ruleId}:${cardId}:${deadline.toISOString()}`;
}

const DEADLINE_BATCH = 200;

/**
 * The "when a card's deadline passes" job. For every enabled rule on a board
 * that is not archived, handles the cards whose deadline day is over, except
 * cards in the board's last column (done) and cards that were overdue before
 * the rule existed. Each rule, card and deadline runs once: the run row with
 * its unique dedupe key is written in the same transaction as the changes, so
 * a second instance (or an overlapping run) fails on the key and skips the
 * card. A changed deadline counts as a new one.
 */
export async function runDeadlineRules(
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<{ runs: RuleRun[] }> {
  const rules = await db.automationRule.findMany({
    where: { trigger: "deadlinePassed", enabled: true, board: { archived: false } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, actions: true, boardId: true, createdAt: true },
  });
  const all: RuleRun[] = [];
  for (const rule of rules) {
    if (parseActions(rule.actions).length === 0) continue;
    const last = await db.boardColumn.findFirst({
      where: { boardId: rule.boardId },
      orderBy: { position: "desc" },
      select: { id: true },
    });
    if (!last) continue;
    const candidates = await db.taskCard.findMany({
      where: {
        column: { boardId: rule.boardId },
        columnId: { not: last.id },
        deadline: { lte: new Date(now.getTime() - DAY), gt: new Date(rule.createdAt.getTime() - DAY) },
      },
      select: { id: true, deadline: true },
    });
    const keyed = candidates
      .filter((c) => c.deadline && deadlinePassed(c.deadline, now))
      .map((c) => ({ cardId: c.id, deadline: c.deadline!, key: deadlineRunKey(rule.id, c.id, c.deadline!) }));
    const done = new Set<string>();
    for (let i = 0; i < keyed.length; i += 500) {
      const rows = await db.automationRun.findMany({
        where: { dedupeKey: { in: keyed.slice(i, i + 500).map((k) => k.key) } },
        select: { dedupeKey: true },
      });
      for (const r of rows) if (r.dedupeKey) done.add(r.dedupeKey);
    }
    for (const c of keyed.filter((k) => !done.has(k.key)).slice(0, DEADLINE_BATCH)) {
      try {
        const runs = await db.$transaction(async (tx) => {
          const env = await loadEnv(tx, c.cardId, now);
          // Moved to another board or given another deadline meanwhile.
          if (!env || env.boardId !== rule.boardId || env.card.deadline !== c.deadline.toISOString()) return [];
          const run = await applyRule(tx, env, rule, { trigger: "deadlinePassed", actorId: null, dedupeKey: c.key });
          if (!run) return [];
          const chain = [run];
          if (run.move) {
            chain.push(
              ...(await runEnterColumnRules(
                tx,
                { cardId: c.cardId, boardId: rule.boardId, columnId: run.move.to.columnId, actorId: null, now },
                2,
                new Set([rule.id])
              ))
            );
          }
          return chain;
        });
        all.push(...runs);
      } catch (err) {
        // Another instance handled this card first (unique dedupe key).
        if (isKnownRequestError(err) && err.code === "P2002") continue;
        throw err;
      }
    }
  }
  return { runs: all };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export interface UndoResult {
  boardId: string;
  cardId: string;
  /** False when the run was undone already (or by someone else meanwhile). */
  undone: boolean;
  fields: string[];
  move: RuleRun["move"];
}

function parseChanges(raw: string): AutomationChange[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as AutomationChange[]) : [];
  } catch {
    return [];
  }
}

/**
 * Reverts what one rule run changed, newest change first, as far as the card
 * still shows it: a tag someone removed by hand since is not added back, a
 * priority someone changed since is kept. Written to the history as the
 * actor's own changes, plus an "undid the rule" entry. Runs once: a second
 * undo (a double click, two people) does nothing.
 */
export async function undoAutomationRun(
  runId: string,
  actorId: string,
  db: PrismaClient = prisma
): Promise<UndoResult | null> {
  const run = await db.automationRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  return db.$transaction(async (tx) => {
    const result: UndoResult = { boardId: run.boardId, cardId: run.cardId, undone: false, fields: [], move: null };
    const claimed = await tx.automationRun.updateMany({ where: { id: runId, undoneAt: null }, data: { undoneAt: new Date() } });
    if (claimed.count === 0) return result;
    const env = await loadEnv(tx, run.cardId, new Date());
    if (!env) return result;
    const card = await tx.taskCard.findUniqueOrThrow({
      where: { id: run.cardId },
      select: { priority: true, deadline: true, columnId: true },
    });
    const inverse: AutomationChange[] = [];
    let reopen: string[] = [];
    let moveBack: { toColumnId: string; position: number | undefined; from: string } | null = null;
    for (const c of parseChanges(run.changes).reverse()) {
      switch (c.kind) {
        case "assigneeAdd":
          if (env.card.assigneeIds.includes(c.userId)) inverse.push({ kind: "assigneeRemove", userId: c.userId });
          break;
        case "assigneeRemove":
          if (env.ctx.memberIds.has(c.userId) && !env.card.assigneeIds.includes(c.userId)) {
            inverse.push({ kind: "assigneeAdd", userId: c.userId });
          }
          break;
        case "tagAdd":
          if (env.card.tagIds.includes(c.tagId)) inverse.push({ kind: "tagRemove", tagId: c.tagId });
          break;
        case "tagRemove":
          if (env.ctx.tagIds.has(c.tagId) && !env.card.tagIds.includes(c.tagId)) inverse.push({ kind: "tagAdd", tagId: c.tagId });
          break;
        case "priority":
          if (card.priority === c.to) inverse.push({ kind: "priority", from: c.to, to: c.from });
          break;
        case "deadline":
          if ((card.deadline?.toISOString() ?? null) === c.to) inverse.push({ kind: "deadline", from: c.to, to: c.from });
          break;
        case "checklistDone":
          reopen = c.subtaskIds;
          break;
        case "move":
          if (card.columnId === c.toColumnId && env.ctx.columnIds.has(c.fromColumnId)) {
            moveBack = { toColumnId: c.fromColumnId, position: c.fromPosition, from: c.toColumnId };
          }
          break;
      }
    }
    if (inverse.length) await writeChanges(tx, env, inverse, actorId, undefined);
    if (reopen.length) {
      await tx.taskSubtask.updateMany({
        where: { id: { in: reopen }, cardId: run.cardId, done: true },
        data: { done: false, completedAt: null, completedById: null },
      });
    }
    if (moveBack) {
      // Back to where it was, not to the bottom of the column.
      const others = await tx.taskCard.findMany({
        where: { columnId: moveBack.toColumnId, id: { not: run.cardId } },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const ids = others.map((o) => o.id);
      const at = Math.max(0, Math.min(moveBack.position ?? ids.length, ids.length));
      ids.splice(at, 0, run.cardId);
      await tx.taskCard.update({ where: { id: run.cardId }, data: { columnId: moveBack.toColumnId } });
      await Promise.all(ids.map((id, position) => tx.taskCard.update({ where: { id }, data: { position } })));
      const from = env.columns.get(moveBack.from) ?? "";
      const to = env.columns.get(moveBack.toColumnId) ?? "";
      await tx.taskCardMoveEvent.create({
        data: { cardId: run.cardId, cardTitle: env.title, boardId: run.boardId, fromColumnName: from, toColumnName: to, userId: actorId },
      });
      await logActivity({ cardId: run.cardId, boardId: run.boardId, actorId, type: "moved", data: { from, to, fromId: moveBack.from, toId: moveBack.toColumnId } }, tx);
      result.move = { from: { columnId: moveBack.from, columnName: from }, to: { columnId: moveBack.toColumnId, columnName: to } };
    }
    await logActivity(
      { cardId: run.cardId, boardId: run.boardId, actorId, type: "automationUndone", data: { ruleName: run.ruleName } },
      tx
    );
    if (!inverse.length) await tx.taskCard.update({ where: { id: run.cardId }, data: { updatedAt: new Date() } });
    result.undone = true;
    result.fields = [...new Set([...fieldsOf(inverse), ...(reopen.length ? ["checklist"] : [])])];
    return result;
  });
}

// ---------------------------------------------------------------------------
// After the commit
// ---------------------------------------------------------------------------

/**
 * Webhooks and notifications for rule runs, like the ones a person's change
 * sends: card.moved for a rule's move and card.updated for the rest, both
 * with `automation: { ruleId, ruleName, runId }`. Call after the transaction
 * committed. Live board updates are the caller's (one per board).
 */
export async function publishRuleRuns(runs: RuleRun[], db: PrismaClient = prisma): Promise<void> {
  if (runs.length === 0) return;
  const [{ emitBoardEvent }, { notify }, { notifyMoved }] = await Promise.all([
    import("@/server/webhooks"),
    import("@/lib/notifications"),
    import("@/server/watchers"),
  ]);
  for (const run of runs) {
    const automation = { ruleId: run.ruleId, ruleName: run.ruleName, runId: run.runId };
    if (run.move) {
      emitBoardEvent(
        run.boardId,
        "card.moved",
        { cardId: run.cardId, actorId: run.actorId, extra: { from: run.move.from, to: run.move.to, automation } },
        db
      );
      await notifyMoved({
        cardId: run.cardId,
        cardTitle: run.cardTitle,
        boardId: run.boardId,
        actorId: run.actorId,
        actorName: run.ruleName,
        toColumnName: run.move.to.columnName,
      });
    }
    if (run.fields.length) {
      emitBoardEvent(
        run.boardId,
        "card.updated",
        { cardId: run.cardId, actorId: run.actorId, extra: { changes: run.fields, automation } },
        db
      );
    }
    for (const userId of run.assigned) {
      await notify({
        recipientId: userId,
        type: "assigned",
        cardId: run.cardId,
        cardTitle: run.cardTitle,
        boardId: run.boardId,
        actorId: run.actorId,
        actorName: run.ruleName,
      });
    }
  }
}
