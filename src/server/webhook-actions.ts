"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import { safeAction } from "@/server/safe-action";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/server/audit";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { sendTestDelivery } from "@/server/webhooks";
import {
  MAX_WEBHOOKS_PER_BOARD,
  WEBHOOK_EVENTS,
  allowPrivateTargets,
  checkWebhookUrl,
} from "@/lib/webhooks";

// Board webhooks: only board owners and admins manage them.

async function manageWebhook(webhookId: string) {
  const hook = await prisma.webhook.findUnique({ where: { id: webhookId }, select: { id: true, boardId: true, url: true } });
  if (!hook) throw new ActionError("notFound");
  const access = await loadBoardAccess(hook.boardId);
  if (!canManageBoard(access)) throw new ActionError("forbidden");
  return { hook, access };
}

const createSchema = z.object({
  boardId: z.string().min(1),
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

/** Adds a webhook. Its signing secret is returned only here. */
export async function createWebhookAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const data = createSchema.parse({
      boardId: formData.get("boardId"),
      url: formData.get("url"),
      events: formData.getAll("events"),
    });
    const access = await loadBoardAccess(data.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const check = checkWebhookUrl(data.url, allowPrivateTargets());
    if (!check.ok) throw new ActionError("webhookUrl");
    const count = await prisma.webhook.count({ where: { boardId: data.boardId } });
    if (count >= MAX_WEBHOOKS_PER_BOARD) throw new ActionError("limitReached");
    const secret = "whsec_" + randomBytes(24).toString("hex");
    const hook = await prisma.webhook.create({
      data: {
        boardId: data.boardId,
        url: check.url.toString(),
        secret,
        events: JSON.stringify([...new Set(data.events)]),
        createdById: user.id,
      },
      select: { id: true, url: true },
    });
    await audit({
      action: "webhook.create",
      actor: { id: user.id, name: user.username },
      target: { type: "webhook", id: hook.id, name: hook.url },
      details: { boardId: data.boardId, events: data.events },
    });
    revalidatePath(`/tasks/${data.boardId}/settings`);
    return { id: hook.id, secret };
  });
}

export async function setWebhookActiveAction(formData: FormData) {
  return safeAction(async () => {
    const { hook } = await manageWebhook(String(formData.get("webhookId") ?? ""));
    const active = formData.get("active") === "true";
    // Switching a webhook back on starts its failure count afresh.
    await prisma.webhook.update({
      where: { id: hook.id },
      data: { active, ...(active ? { failureCount: 0 } : {}) },
    });
    revalidatePath(`/tasks/${hook.boardId}/settings`);
  });
}

export async function deleteWebhookAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const { hook } = await manageWebhook(String(formData.get("webhookId") ?? ""));
    await prisma.webhook.delete({ where: { id: hook.id } });
    await audit({
      action: "webhook.delete",
      actor: { id: user.id, name: user.username },
      target: { type: "webhook", id: hook.id, name: hook.url },
      details: { boardId: hook.boardId },
    });
    revalidatePath(`/tasks/${hook.boardId}/settings`);
  });
}

/** Sends a signed `ping` right away and reports the receiver's answer. */
export async function testWebhookAction(formData: FormData) {
  return safeAction(async () => {
    const { hook, access } = await manageWebhook(String(formData.get("webhookId") ?? ""));
    const result = await sendTestDelivery(hook.id, access.userId);
    revalidatePath(`/tasks/${hook.boardId}/settings`);
    return { ok: result.ok, status: result.status };
  });
}
