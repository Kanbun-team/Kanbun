"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { publishBoard } from "@/lib/realtime";
import { safeAction } from "@/server/safe-action";
import { ActionError } from "@/lib/action-result";
import { checklistFromText } from "@/lib/card-templates";
import { nextOccurrence, toRule } from "@/lib/recurrence";
import { createCardFromTemplate } from "@/server/card-templates";
import { publishRuleRuns, runNotices } from "@/server/automations";
import { emitBoardEvent } from "@/server/webhooks";
import { notifyNewCards } from "@/server/watchers";

async function actorName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
  return u?.displayName ?? u?.username ?? "";
}

// Card templates and recurring-card schedules. Board owners and admins manage
// both in board settings; every board member can create a card from a
// template.

const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  tagIds: z.array(z.string().min(1)).max(50).default([]),
  checklist: z.string().max(20_000).default(""),
});

function parseTemplate(formData: FormData) {
  return templateSchema.parse({
    name: formData.get("name"),
    title: formData.get("title"),
    description: formData.get("description") || null,
    priority: formData.get("priority") || "normal",
    tagIds: formData.getAll("tagIds").map(String).filter(Boolean),
    checklist: formData.get("checklist") ?? "",
  });
}

async function manageableBoard(boardId: string) {
  const access = await loadBoardAccess(boardId);
  if (!canManageBoard(access)) throw new ActionError("forbidden");
  return access;
}

async function boardTagIds(boardId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.boardTag.findMany({ where: { boardId, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

function revalidateBoard(boardId: string) {
  revalidatePath(`/tasks/${boardId}`);
  revalidatePath(`/tasks/${boardId}/settings`);
  publishBoard(boardId);
}

export async function createCardTemplateAction(formData: FormData) {
  return safeAction(async () => {
    const boardId = z.string().min(1).parse(formData.get("boardId"));
    const access = await manageableBoard(boardId);
    const data = parseTemplate(formData);
    const template = await prisma.cardTemplate.create({
      data: {
        boardId,
        name: data.name,
        title: data.title,
        description: data.description,
        priority: data.priority,
        tagIds: JSON.stringify(await boardTagIds(boardId, data.tagIds)),
        checklist: JSON.stringify(checklistFromText(data.checklist)),
        createdById: access.userId,
      },
      select: { id: true },
    });
    revalidateBoard(boardId);
    return { id: template.id };
  });
}

export async function updateCardTemplateAction(formData: FormData) {
  return safeAction(async () => {
    const templateId = z.string().min(1).parse(formData.get("templateId"));
    const existing = await prisma.cardTemplate.findUnique({ where: { id: templateId }, select: { boardId: true } });
    if (!existing) throw new ActionError("notFound");
    await manageableBoard(existing.boardId);
    const data = parseTemplate(formData);
    await prisma.cardTemplate.update({
      where: { id: templateId },
      data: {
        name: data.name,
        title: data.title,
        description: data.description,
        priority: data.priority,
        tagIds: JSON.stringify(await boardTagIds(existing.boardId, data.tagIds)),
        checklist: JSON.stringify(checklistFromText(data.checklist)),
      },
    });
    revalidateBoard(existing.boardId);
  });
}

export async function deleteCardTemplateAction(formData: FormData) {
  return safeAction(async () => {
    const templateId = z.string().min(1).parse(formData.get("templateId"));
    const existing = await prisma.cardTemplate.findUnique({ where: { id: templateId }, select: { boardId: true } });
    if (!existing) throw new ActionError("notFound");
    await manageableBoard(existing.boardId);
    // Schedules that used it stop: they would have nothing to create.
    await prisma.$transaction([
      prisma.cardRecurrence.updateMany({ where: { templateId }, data: { active: false } }),
      prisma.cardTemplate.delete({ where: { id: templateId } }),
    ]);
    revalidateBoard(existing.boardId);
  });
}

/** Copies a card's title, description, priority, tags and checklist titles. */
export async function saveCardAsTemplateAction(formData: FormData) {
  return safeAction(async () => {
    const cardId = z.string().min(1).parse(formData.get("cardId"));
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: {
        title: true,
        description: true,
        priority: true,
        column: { select: { boardId: true } },
        tags: { select: { tagId: true } },
        subtasks: { orderBy: { position: "asc" }, select: { title: true } },
      },
    });
    if (!card) throw new ActionError("notFound");
    const boardId = card.column.boardId;
    const access = await manageableBoard(boardId);
    const name = z.string().trim().max(80).parse(String(formData.get("name") ?? "")) || card.title.slice(0, 80);
    const template = await prisma.cardTemplate.create({
      data: {
        boardId,
        name,
        title: card.title,
        description: card.description,
        priority: card.priority,
        tagIds: JSON.stringify(card.tags.map((tg) => tg.tagId)),
        checklist: JSON.stringify(card.subtasks.map((s) => s.title).slice(0, 50)),
        createdById: access.userId,
      },
      select: { id: true, name: true },
    });
    revalidateBoard(boardId);
    return template;
  });
}

export async function createCardFromTemplateAction(input: { templateId: string; columnId: string }) {
  return safeAction(async () => {
    const data = z.object({ templateId: z.string().min(1), columnId: z.string().min(1) }).parse(input);
    const column = await prisma.boardColumn.findUnique({
      where: { id: data.columnId },
      select: { id: true, name: true, boardId: true },
    });
    if (!column) throw new ActionError("notFound");
    const access = await loadBoardAccess(column.boardId);
    const template = await prisma.cardTemplate.findUnique({ where: { id: data.templateId } });
    if (!template || template.boardId !== column.boardId) throw new ActionError("notFound");
    const card = await prisma.$transaction((tx) =>
      createCardFromTemplate(tx, { template, column, actorId: access.userId, source: "template" })
    );
    await notifyNewCards(column.boardId, [card], { id: access.userId, name: await actorName(access.userId) });
    revalidatePath(`/tasks/${column.boardId}`);
    publishBoard(column.boardId);
    emitBoardEvent(column.boardId, "card.created", { cardId: card.id, actorId: access.userId });
    await publishRuleRuns(card.runs);
    return { cardId: card.id, automation: runNotices(card.runs) };
  });
}

// -----------------------------
// Recurring cards
// -----------------------------

const optionalInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().int().nullable()
);

const recurrenceSchema = z.object({
  boardId: z.string().min(1),
  templateId: z.string().min(1),
  columnId: z.string().min(1),
  rule: z.enum(["daily", "weekly", "monthly"]),
  weekday: optionalInt,
  monthDay: optionalInt,
  timeOfDay: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export async function createRecurrenceAction(formData: FormData) {
  return safeAction(async () => {
    const data = recurrenceSchema.parse({
      boardId: formData.get("boardId"),
      templateId: formData.get("templateId"),
      columnId: formData.get("columnId"),
      rule: formData.get("rule"),
      weekday: formData.get("weekday"),
      monthDay: formData.get("monthDay"),
      timeOfDay: formData.get("timeOfDay"),
    });
    const access = await manageableBoard(data.boardId);
    const rule = toRule(data);
    if (!rule) throw new ActionError("invalid");
    const [template, column] = await Promise.all([
      prisma.cardTemplate.findUnique({ where: { id: data.templateId }, select: { boardId: true } }),
      prisma.boardColumn.findUnique({ where: { id: data.columnId }, select: { boardId: true } }),
    ]);
    if (template?.boardId !== data.boardId || column?.boardId !== data.boardId) throw new ActionError("invalid");
    await prisma.cardRecurrence.create({
      data: {
        boardId: data.boardId,
        templateId: data.templateId,
        columnId: data.columnId,
        rule: rule.rule,
        weekday: rule.rule === "weekly" ? rule.weekday : null,
        monthDay: rule.rule === "monthly" ? rule.monthDay : null,
        timeOfDay: rule.timeOfDay,
        nextRunAt: nextOccurrence(rule, new Date()),
        createdById: access.userId,
      },
    });
    revalidatePath(`/tasks/${data.boardId}/settings`);
  });
}

/** Pause or resume. Resuming schedules the next run from now, never in the past. */
export async function setRecurrenceActiveAction(formData: FormData) {
  return safeAction(async () => {
    const id = z.string().min(1).parse(formData.get("recurrenceId"));
    const active = formData.get("active") === "true";
    const r = await prisma.cardRecurrence.findUnique({ where: { id } });
    if (!r) throw new ActionError("notFound");
    await manageableBoard(r.boardId);
    const rule = toRule(r);
    if (active && (!rule || !r.templateId || !r.columnId)) throw new ActionError("invalid");
    await prisma.cardRecurrence.update({
      where: { id },
      data: active && rule ? { active: true, nextRunAt: nextOccurrence(rule, new Date()) } : { active: false },
    });
    revalidatePath(`/tasks/${r.boardId}/settings`);
  });
}

export async function deleteRecurrenceAction(formData: FormData) {
  return safeAction(async () => {
    const id = z.string().min(1).parse(formData.get("recurrenceId"));
    const r = await prisma.cardRecurrence.findUnique({ where: { id }, select: { boardId: true } });
    if (!r) throw new ActionError("notFound");
    await manageableBoard(r.boardId);
    await prisma.cardRecurrence.delete({ where: { id } });
    revalidatePath(`/tasks/${r.boardId}/settings`);
  });
}
