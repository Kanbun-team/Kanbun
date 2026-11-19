"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import { safeAction } from "@/server/safe-action";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/server/audit";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { publishBoard } from "@/lib/realtime";
import { emitBoardEvent } from "@/server/webhooks";
import { undoAutomationRun } from "@/server/automations";
import {
  MAX_RULES_PER_BOARD,
  automationRuleInputSchema,
  type AutomationRuleData,
  type AutomationRuleInput,
} from "@/lib/automations";

// Board automation rules: board owners and admins manage them in board
// settings. Undoing a rule's changes is open to every board member, like
// editing the card by hand.

/** Columns, tags and people named by the rule must belong to the board. */
async function checkRefs(boardId: string, rule: AutomationRuleData): Promise<void> {
  const columnIds = new Set<string>();
  const tagIds = new Set<string>();
  const userIds = new Set<string>();
  if (rule.columnId) columnIds.add(rule.columnId);
  for (const a of rule.actions) {
    if (a.type === "moveToColumn") columnIds.add(a.columnId);
    if (a.type === "addTag" || a.type === "removeTag") tagIds.add(a.tagId);
    if (a.type === "assign") for (const id of a.userIds) userIds.add(id);
  }
  const [columns, tags, members] = await Promise.all([
    prisma.boardColumn.count({ where: { boardId, id: { in: [...columnIds] } } }),
    prisma.boardTag.count({ where: { boardId, id: { in: [...tagIds] } } }),
    prisma.boardMember.count({ where: { boardId, userId: { in: [...userIds] }, user: { deactivatedAt: null } } }),
  ]);
  if (columns !== columnIds.size || tags !== tagIds.size || members !== userIds.size) throw new ActionError("invalid");
}

async function manageRule(ruleId: string) {
  const rule = await prisma.automationRule.findUnique({
    where: { id: z.string().min(1).parse(ruleId) },
    select: { id: true, boardId: true, name: true },
  });
  if (!rule) throw new ActionError("notFound");
  const access = await loadBoardAccess(rule.boardId);
  if (!canManageBoard(access)) throw new ActionError("forbidden");
  return rule;
}

function refresh(boardId: string) {
  revalidatePath(`/tasks/${boardId}/settings`);
}

export async function createAutomationRuleAction(boardId: string, input: AutomationRuleInput) {
  return safeAction(async () => {
    const user = await requireUser();
    const access = await loadBoardAccess(z.string().min(1).parse(boardId));
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const data = automationRuleInputSchema.parse(input);
    await checkRefs(boardId, data);
    const count = await prisma.automationRule.count({ where: { boardId } });
    if (count >= MAX_RULES_PER_BOARD) throw new ActionError("limitReached");
    const rule = await prisma.automationRule.create({
      data: {
        boardId,
        name: data.name,
        trigger: data.trigger,
        columnId: data.columnId,
        actions: JSON.stringify(data.actions),
        enabled: data.enabled,
        createdById: user.id,
      },
      select: { id: true },
    });
    await audit({
      action: "automation.create",
      actor: { id: user.id, name: user.username },
      target: { type: "automation", id: rule.id, name: data.name },
      details: { boardId, trigger: data.trigger, actions: data.actions.map((a) => a.type) },
    });
    refresh(boardId);
    return { id: rule.id };
  });
}

export async function updateAutomationRuleAction(ruleId: string, input: AutomationRuleInput) {
  return safeAction(async () => {
    const user = await requireUser();
    const rule = await manageRule(ruleId);
    const data = automationRuleInputSchema.parse(input);
    await checkRefs(rule.boardId, data);
    await prisma.automationRule.update({
      where: { id: rule.id },
      data: {
        name: data.name,
        trigger: data.trigger,
        columnId: data.columnId,
        actions: JSON.stringify(data.actions),
        enabled: data.enabled,
      },
    });
    await audit({
      action: "automation.update",
      actor: { id: user.id, name: user.username },
      target: { type: "automation", id: rule.id, name: data.name },
      details: { boardId: rule.boardId, trigger: data.trigger, actions: data.actions.map((a) => a.type), enabled: data.enabled },
    });
    refresh(rule.boardId);
  });
}

export async function setAutomationRuleEnabledAction(ruleId: string, enabled: boolean) {
  return safeAction(async () => {
    const user = await requireUser();
    const rule = await manageRule(ruleId);
    const on = z.boolean().parse(enabled);
    await prisma.automationRule.update({ where: { id: rule.id }, data: { enabled: on } });
    await audit({
      action: "automation.update",
      actor: { id: user.id, name: user.username },
      target: { type: "automation", id: rule.id, name: rule.name },
      details: { boardId: rule.boardId, enabled: on },
    });
    refresh(rule.boardId);
  });
}

export async function deleteAutomationRuleAction(ruleId: string) {
  return safeAction(async () => {
    const user = await requireUser();
    const rule = await manageRule(ruleId);
    await prisma.automationRule.delete({ where: { id: rule.id } });
    await audit({
      action: "automation.delete",
      actor: { id: user.id, name: user.username },
      target: { type: "automation", id: rule.id, name: rule.name },
      details: { boardId: rule.boardId },
    });
    refresh(rule.boardId);
  });
}

/** "Undo" on a rule's changes (the toast after a move, or the card history). */
export async function undoAutomationRunAction(runId: string) {
  return safeAction(async () => {
    const id = z.string().min(1).parse(runId);
    const run = await prisma.automationRun.findUnique({ where: { id }, select: { boardId: true, cardId: true } });
    if (!run) throw new ActionError("notFound");
    const card = await prisma.taskCard.findUnique({ where: { id: run.cardId }, select: { column: { select: { boardId: true } } } });
    if (!card) throw new ActionError("notFound");
    const access = await loadBoardAccess(card.column.boardId);
    const result = await undoAutomationRun(id, access.userId);
    if (!result?.undone) return { undone: false };
    const boardId = card.column.boardId;
    revalidatePath(`/tasks/${boardId}`);
    revalidatePath(`/tasks/${boardId}/cards/${run.cardId}`);
    publishBoard(boardId);
    if (result.move) {
      emitBoardEvent(boardId, "card.moved", {
        cardId: run.cardId,
        actorId: access.userId,
        extra: { from: result.move.from, to: result.move.to },
      });
    }
    if (result.fields.length) {
      emitBoardEvent(boardId, "card.updated", { cardId: run.cardId, actorId: access.userId, extra: { changes: result.fields } });
    }
    return { undone: true };
  });
}
