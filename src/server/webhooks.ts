// Outgoing webhook deliveries. `emitBoardEvent()` is the one entry point for
// card and comment changes, called from the server actions and the REST API.
// It returns at once: the payload is built and delivered from a small
// in-process queue, so a slow or broken receiver never delays the user.
//
// Each delivery is a signed POST (see src/lib/webhooks.ts), tried up to
// MAX_ATTEMPTS times with backoff, 10 seconds each. A webhook that fails
// WEBHOOK_FAILURE_LIMIT deliveries in a row is switched off. Queued
// deliveries live in memory and are lost on restart.
//
// SSRF: only http(s) URLs, and every address the host name resolves to must
// be public, checked inside the connection's DNS lookup so the address that
// was checked is the one connected to. WEBHOOK_ALLOW_PRIVATE=1 lifts the
// address checks for setups that post to other services on the local network.

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { randomUUID } from "node:crypto";
import type { LookupFunction } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import {
  TEST_EVENT,
  WEBHOOK_FAILURE_LIMIT,
  WEBHOOK_HISTORY,
  allowPrivateTargets,
  checkWebhookUrl,
  isBlockedAddress,
  parseEvents,
  signPayload,
  type WebhookEvent,
} from "@/lib/webhooks";
import { cardInclude, cardJson, dateOnly, userRef, userRefSelect } from "@/server/api/serialize";

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Wait before the 2nd and 3rd attempt. */
const BACKOFF_MS = [5_000, 30_000];
const CONCURRENCY = 4;
const USER_AGENT = "Kanbun-Webhook/1.0";

export interface EventInput {
  cardId: string;
  actorId?: string | null;
  /** Extra fields merged into the payload, e.g. `changes`, `from`, `to`. */
  extra?: Record<string, unknown>;
  /** For comment.created. */
  commentId?: string;
}

/**
 * Queues `event` for every active webhook of the board subscribed to it.
 * Never throws and never waits for the network. `db` is for callers that run
 * on another client (the background jobs in tests).
 */
export function emitBoardEvent(boardId: string, event: WebhookEvent, input: EventInput, db: PrismaClient = prisma): void {
  void dispatch(db, boardId, event, input).catch((err) => console.error("[webhooks] emit failed", event, err));
}

const FIELD_OF_ACTIVITY: Record<string, string> = {
  renamed: "title",
  priority: "priority",
  deadline: "deadline",
  description: "description",
  assigneeAdded: "assignees",
  assigneeRemoved: "assignees",
  tagAdded: "tags",
  tagRemoved: "tags",
};

/** The card fields a list of card history entries changed, for `card.updated`. */
export function changedFields(entries: { type: string }[]): string[] {
  return [...new Set(entries.map((e) => FIELD_OF_ACTIVITY[e.type]).filter(Boolean))];
}

async function dispatch(db: PrismaClient, boardId: string, event: WebhookEvent, input: EventInput): Promise<void> {
  const hooks = (
    await db.webhook.findMany({ where: { boardId, active: true }, select: { id: true, events: true } })
  ).filter((h) => parseEvents(h.events).includes(event));
  if (hooks.length === 0) return;

  const payload = await buildPayload(db, boardId, event, input);
  if (!payload) return;
  for (const hook of hooks) {
    const deliveryId = randomUUID();
    const body = JSON.stringify({ ...payload, id: deliveryId, deliveredAt: new Date().toISOString() });
    enqueue({ webhookId: hook.id, event, deliveryId, body });
  }
}

async function buildPayload(db: PrismaClient, boardId: string, event: WebhookEvent, input: EventInput) {
  const [board, actor] = await Promise.all([
    db.board.findUnique({ where: { id: boardId }, select: { id: true, name: true } }),
    input.actorId ? db.user.findUnique({ where: { id: input.actorId }, select: userRefSelect }) : null,
  ]);
  if (!board) return null;

  let card: Record<string, unknown> | null = null;
  if (event === "card.deleted") {
    // The card is gone already; describe it from its trash snapshot.
    const item = await db.trashItem.findFirst({
      where: { kind: "card", entityId: input.cardId },
      orderBy: { deletedAt: "desc" },
      select: { id: true, payload: true },
    });
    const snap = item ? (JSON.parse(item.payload) as Record<string, unknown>) : {};
    card = {
      id: input.cardId,
      boardId,
      columnId: snap.columnId ?? null,
      title: snap.title ?? null,
      description: snap.description ?? null,
      priority: snap.priority ?? null,
      deadline: typeof snap.deadline === "string" ? dateOnly(new Date(snap.deadline)) : null,
      trashId: item?.id ?? null,
    };
  } else {
    const row = await db.taskCard.findUnique({ where: { id: input.cardId }, include: cardInclude });
    if (!row) return null;
    card = cardJson(row);
  }

  let comment: Record<string, unknown> | undefined;
  if (input.commentId) {
    const c = await db.taskCardComment.findUnique({
      where: { id: input.commentId },
      include: { author: { select: userRefSelect } },
    });
    if (c) comment = { id: c.id, body: c.body, author: userRef(c.author), createdAt: c.createdAt.toISOString() };
  }

  return { event, board, card, actor: userRef(actor), ...(comment ? { comment } : {}), ...input.extra };
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface Job {
  webhookId: string;
  event: string;
  deliveryId: string;
  body: string;
}

const globalForQueue = globalThis as unknown as {
  __kanbunWebhookQueue?: { pending: Job[]; running: number };
};
const queue = (globalForQueue.__kanbunWebhookQueue ??= { pending: [], running: 0 });

function enqueue(job: Job): void {
  queue.pending.push(job);
  pump();
}

function pump(): void {
  while (queue.running < CONCURRENCY && queue.pending.length > 0) {
    const job = queue.pending.shift()!;
    queue.running += 1;
    void deliver(job)
      .catch((err) => console.error("[webhooks] delivery crashed", err))
      .finally(() => {
        queue.running -= 1;
        pump();
      });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

/** Runs every attempt of one delivery, recording the outcome. */
async function deliver(job: Job, attempts = MAX_ATTEMPTS): Promise<AttemptResult> {
  const record = await prisma.webhookDelivery
    .create({ data: { webhookId: job.webhookId, event: job.event }, select: { id: true } })
    .catch(() => null);
  if (!record) return { ok: false, status: null, durationMs: 0, error: "Webhook no longer exists." };

  let result: AttemptResult = { ok: false, status: null, durationMs: 0, error: "Not sent." };
  let tried = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Re-read each time: the webhook may have been switched off, edited or deleted.
    const hook = await prisma.webhook.findUnique({
      where: { id: job.webhookId },
      select: { url: true, secret: true, active: true },
    });
    if (!hook || (!hook.active && job.event !== TEST_EVENT)) break;
    tried = attempt;
    result = await send(hook.url, hook.secret, job);
    // Client errors other than timeouts and rate limits will not get better.
    if (result.ok || (result.status && result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status))) {
      break;
    }
    if (attempt < attempts) await sleep(BACKOFF_MS[attempt - 1] ?? 30_000);
  }
  await finish(job.webhookId, record.id, tried, result);
  return result;
}

async function finish(webhookId: string, deliveryRowId: string, attempts: number, r: AttemptResult): Promise<void> {
  try {
    await prisma.webhookDelivery.update({
      where: { id: deliveryRowId },
      data: { success: r.ok, statusCode: r.status, durationMs: r.durationMs, error: r.error, attempts },
    });
    if (attempts > 0) {
      const hook = await prisma.webhook.update({
        where: { id: webhookId },
        data: {
          lastStatus: r.status ?? 0,
          lastDeliveredAt: new Date(),
          failureCount: r.ok ? 0 : { increment: 1 },
        },
        select: { failureCount: true, active: true },
      });
      if (hook.active && hook.failureCount >= WEBHOOK_FAILURE_LIMIT) {
        await prisma.webhook.update({ where: { id: webhookId }, data: { active: false } });
        console.warn(`[webhooks] ${webhookId} switched off after ${hook.failureCount} failed deliveries`);
      }
    }
    const old = await prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: "desc" },
      skip: WEBHOOK_HISTORY,
      select: { id: true },
    });
    if (old.length) await prisma.webhookDelivery.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  } catch {
    // The webhook was deleted while the delivery ran.
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface AttemptResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
}

/** dns.lookup that refuses non-public addresses (unless allowed). */
export function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0) return callback(new Error("No address found."), "", 0);
      if (!allowPrivate && list.some((a) => isBlockedAddress(a.address))) {
        const blocked = Object.assign(new Error("The host resolves to a private or reserved address."), {
          code: "EBLOCKED",
        });
        return callback(blocked, "", 0);
      }
      if (options.all) (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

export function send(rawUrl: string, secret: string, job: Job): Promise<AttemptResult> {
  const started = Date.now();
  const allowPrivate = allowPrivateTargets();
  const check = checkWebhookUrl(rawUrl, allowPrivate);
  if (!check.ok) {
    return Promise.resolve({ ok: false, status: null, durationMs: 0, error: `URL not allowed (${check.reason}).` });
  }
  const url = check.url;
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Omit<AttemptResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, durationMs: Date.now() - started });
    };
    const req = client.request(
      url,
      {
        method: "POST",
        lookup: guardedLookup(allowPrivate),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(job.body),
          "User-Agent": USER_AGENT,
          "X-Kanbun-Event": job.event,
          "X-Kanbun-Delivery": job.deliveryId,
          "X-Kanbun-Signature": signPayload(secret, job.body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Redirects are not followed: the target could point anywhere.
        res.resume();
        res.on("end", () =>
          done({ ok: status >= 200 && status < 300, status, error: status >= 200 && status < 300 ? null : `HTTP ${status}` })
        );
        res.on("error", (err) => done({ ok: false, status, error: err.message }));
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("Timed out after 10 seconds."));
    }, TIMEOUT_MS);
    req.on("error", (err) => done({ ok: false, status: null, error: err.message.slice(0, 300) }));
    req.end(job.body);
  });
}

/**
 * The "Send test" button: one signed `ping` delivery, sent right away and
 * awaited (once, without retries) so the result can be shown.
 */
export async function sendTestDelivery(webhookId: string, actorId: string): Promise<AttemptResult> {
  const hook = await prisma.webhook.findUniqueOrThrow({
    where: { id: webhookId },
    select: { id: true, events: true, board: { select: { id: true, name: true } } },
  });
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: userRefSelect });
  const deliveryId = randomUUID();
  const body = JSON.stringify({
    event: TEST_EVENT,
    id: deliveryId,
    deliveredAt: new Date().toISOString(),
    board: hook.board,
    card: null,
    actor: userRef(actor),
    webhook: { id: hook.id, events: parseEvents(hook.events) },
  });
  return deliver({ webhookId, event: TEST_EVENT, deliveryId, body }, 1);
}
