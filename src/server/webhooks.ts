// Outgoing webhook deliveries. `emitBoardEvent()` is the one entry point for
// card and comment changes, called from the server actions and the REST API.
// It returns at once: the payload is built and stored as a pending
// WebhookDelivery row (the outbox), then sent in the background, so a slow or
// broken receiver never delays the user and a restart loses nothing.
//
// Each delivery is a signed POST (see src/lib/webhooks.ts), tried up to
// MAX_ATTEMPTS times with backoff, 10 seconds each. Sending starts right
// after the row is written, in the same process; the `webhooks` background
// job (src/server/jobs/index.ts) picks up whatever is left, after a restart
// or from another instance. Workers claim an attempt with a conditional
// update, so two never send the same attempt. A worker that dies mid-send
// leaves a lease that expires, and the attempt is made again: delivery is
// at-least-once. A webhook that fails WEBHOOK_FAILURE_LIMIT deliveries in a
// row is switched off.
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
/** How long a claimed attempt stays reserved; well above TIMEOUT_MS. */
const LEASE_MS = 60_000;
/** Due deliveries read per round. */
const BATCH = 20;
const USER_AGENT = "Kanbun-Webhook/1.0";

export interface EventInput {
  cardId: string;
  actorId?: string | null;
  /** Extra fields merged into the payload, e.g. `changes`, `from`, `to`. */
  extra?: Record<string, unknown>;
  /** For comment.created. */
  commentId?: string;
  /** For card.deleted: the trash item holding the card (a card or a column). */
  trashId?: string;
}

/**
 * Queues `event` for every active webhook of the board subscribed to it.
 * Never throws and never waits for the network. `db` is for callers that run
 * on another client (the background jobs in tests).
 */
export function emitBoardEvent(boardId: string, event: WebhookEvent, input: EventInput, db: PrismaClient = prisma): void {
  void queueBoardEvent(db, boardId, event, input).catch((err) => console.error("[webhooks] emit failed", event, err));
}

/**
 * Deleting a column trashes its cards with it: each card gets its own
 * card.deleted, with the column it was in (`column`) and `reason` set to
 * "column.deleted". Call after the column went to the trash.
 */
export function emitColumnCardsDeleted(
  boardId: string,
  column: { id: string; name: string },
  cardIds: string[],
  trashId: string,
  actorId: string
): void {
  for (const cardId of cardIds) {
    emitBoardEvent(boardId, "card.deleted", {
      cardId,
      actorId,
      trashId,
      extra: { reason: "column.deleted", column: { columnId: column.id, columnName: column.name } },
    });
  }
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

function cardSnapshotIn(kind: string, payload: string, cardId: string): Record<string, unknown> {
  try {
    const snap = JSON.parse(payload) as Record<string, unknown> & { cards?: Record<string, unknown>[] };
    if (kind === "card") return snap;
    return snap.cards?.find((c) => c.id === cardId) ?? {};
  } catch {
    return {};
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
    // The card is gone already; describe it from its trash snapshot, which
    // is the card's own or, when its column was deleted, the column's.
    const item = input.trashId
      ? await db.trashItem.findUnique({ where: { id: input.trashId }, select: { id: true, kind: true, payload: true } })
      : await db.trashItem.findFirst({
          where: { kind: "card", entityId: input.cardId },
          orderBy: { deletedAt: "desc" },
          select: { id: true, kind: true, payload: true },
        });
    const snap = item ? cardSnapshotIn(item.kind, item.payload, input.cardId) : {};
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
// Queue: pending WebhookDelivery rows are the outbox
// ---------------------------------------------------------------------------

export interface Job {
  webhookId: string;
  event: string;
  deliveryId: string;
  body: string;
}

/** Attempts per delivery: the `ping` from "Send test" is tried once. */
const maxAttemptsFor = (event: string) => (event === TEST_EVENT ? 1 : MAX_ATTEMPTS);

/**
 * Stores one pending delivery per active webhook of the board subscribed to
 * `event`, then starts sending. Resolves to the number queued.
 */
export async function queueBoardEvent(
  db: PrismaClient,
  boardId: string,
  event: WebhookEvent,
  input: EventInput
): Promise<number> {
  const hooks = (
    await db.webhook.findMany({ where: { boardId, active: true }, select: { id: true, events: true } })
  ).filter((h) => parseEvents(h.events).includes(event));
  if (hooks.length === 0) return 0;

  const payload = await buildPayload(db, boardId, event, input);
  if (!payload) return 0;
  const now = new Date();
  const rows = hooks.map((hook) => {
    const id = randomUUID();
    const body = JSON.stringify({ ...payload, id, deliveredAt: now.toISOString() });
    return { id, webhookId: hook.id, event, payload: body, nextAttemptAt: now };
  });
  await db.webhookDelivery.createMany({ data: rows });
  kickWebhookQueue(db);
  return rows.length;
}

interface Worker {
  running: Promise<void> | null;
  again: boolean;
}

// One drain loop per process (per client, so tests can use their own database).
const globalForWorkers = globalThis as unknown as { __kanbunWebhookWorkers?: WeakMap<PrismaClient, Worker> };
const workers = (globalForWorkers.__kanbunWebhookWorkers ??= new WeakMap<PrismaClient, Worker>());

/**
 * Sends every due delivery until none is left. Runs right after a delivery
 * is queued, when a retry falls due, and from the `webhooks` background job,
 * which picks up what a restart or another instance left behind. A call while
 * the loop runs makes it go round once more and resolves with it.
 */
export function runWebhookQueue(db: PrismaClient = prisma): Promise<void> {
  let w = workers.get(db);
  if (!w) {
    w = { running: null, again: false };
    workers.set(db, w);
  }
  const worker = w;
  if (worker.running) {
    worker.again = true;
    return worker.running;
  }
  worker.running = (async () => {
    try {
      do {
        worker.again = false;
        await drain(db);
      } while (worker.again);
    } finally {
      worker.running = null;
    }
  })();
  return worker.running;
}

function kickWebhookQueue(db: PrismaClient): void {
  void runWebhookQueue(db).catch((err) => console.error("[webhooks] queue failed", err));
}

async function drain(db: PrismaClient): Promise<void> {
  // Bounded, so a database that keeps refusing updates can not spin forever;
  // the background job comes back for the rest.
  for (let round = 0; round < 50; round++) {
    const due = await db.webhookDelivery.findMany({
      where: { status: "pending", nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: BATCH,
      select: pendingSelect,
    });
    if (due.length === 0) return;
    let next = 0;
    const lane = async () => {
      while (next < due.length) {
        const row = due[next++];
        await attempt(db, row).catch((err) => console.error("[webhooks] delivery crashed", row.id, err));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, lane));
    if (due.length < BATCH) return;
  }
}

const pendingSelect = {
  id: true,
  webhookId: true,
  event: true,
  payload: true,
  attempts: true,
  nextAttemptAt: true,
  error: true,
} as const;

interface PendingRow {
  id: string;
  webhookId: string;
  event: string;
  payload: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  error: string | null;
}

/** Makes the next attempt of one delivery, if this worker wins the claim. */
async function attempt(db: PrismaClient, row: PendingRow): Promise<void> {
  // Re-read each time: the webhook may have been switched off, edited or deleted.
  const hook = await db.webhook.findUnique({
    where: { id: row.webhookId },
    select: { url: true, secret: true, active: true },
  });
  if (!hook) return; // deleted: its deliveries go with it
  const max = maxAttemptsFor(row.event);
  if (row.attempts >= max || row.payload === null) {
    // The last attempt was claimed but never recorded: the process stopped mid-send.
    await finish(db, row, row.attempts, { ok: false, status: null, durationMs: 0, error: row.error ?? "Interrupted." });
    return;
  }
  if (!hook.active && row.event !== TEST_EVENT) {
    await finish(db, row, row.attempts, { ok: false, status: null, durationMs: 0, error: row.error ?? "Not sent." });
    return;
  }

  // Claim: only one worker can move the row out of this exact state. Pushing
  // nextAttemptAt forward is the lease that brings back a send that crashed.
  const tries = row.attempts + 1;
  const claimed = await db.webhookDelivery.updateMany({
    where: { id: row.id, status: "pending", attempts: row.attempts, nextAttemptAt: row.nextAttemptAt },
    data: { attempts: tries, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count !== 1) return;

  const result = await send(hook.url, hook.secret, {
    webhookId: row.webhookId,
    event: row.event,
    deliveryId: row.id,
    body: row.payload,
  });
  // Client errors other than timeouts and rate limits will not get better.
  const hopeless = result.status !== null && result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status);
  if (result.ok || hopeless || tries >= max) {
    await finish(db, row, tries, result);
    return;
  }
  const wait = BACKOFF_MS[tries - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  await db.webhookDelivery.updateMany({
    where: { id: row.id, status: "pending", attempts: tries },
    data: {
      statusCode: result.status,
      durationMs: result.durationMs,
      error: result.error,
      nextAttemptAt: new Date(Date.now() + wait),
    },
  });
  // Come back on time; the background job is the fallback after a restart.
  setTimeout(() => kickWebhookQueue(db), wait + 50).unref?.();
}

/** Records the outcome of a delivery, updates the webhook and prunes the history. */
async function finish(
  db: PrismaClient,
  row: { id: string; webhookId: string },
  attempts: number,
  r: AttemptResult
): Promise<void> {
  try {
    const done = await db.webhookDelivery.updateMany({
      where: { id: row.id, status: "pending" },
      data: {
        status: r.ok ? "success" : "failed",
        success: r.ok,
        statusCode: r.status,
        durationMs: r.durationMs,
        error: r.error,
        attempts,
        payload: null,
        nextAttemptAt: null,
      },
    });
    if (done.count !== 1) return;
    if (attempts > 0) {
      const hook = await db.webhook.update({
        where: { id: row.webhookId },
        data: {
          lastStatus: r.status ?? 0,
          lastDeliveredAt: new Date(),
          failureCount: r.ok ? 0 : { increment: 1 },
        },
        select: { failureCount: true, active: true },
      });
      if (hook.active && hook.failureCount >= WEBHOOK_FAILURE_LIMIT) {
        await db.webhook.update({ where: { id: row.webhookId }, data: { active: false } });
        console.warn(`[webhooks] ${row.webhookId} switched off after ${hook.failureCount} failed deliveries`);
      }
    }
    // Keep the last WEBHOOK_HISTORY finished deliveries; pending ones stay.
    const old = await db.webhookDelivery.findMany({
      where: { webhookId: row.webhookId, status: { not: "pending" } },
      orderBy: { createdAt: "desc" },
      skip: WEBHOOK_HISTORY,
      select: { id: true },
    });
    if (old.length) await db.webhookDelivery.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
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
export async function sendTestDelivery(
  webhookId: string,
  actorId: string,
  db: PrismaClient = prisma
): Promise<AttemptResult> {
  const hook = await db.webhook.findUniqueOrThrow({
    where: { id: webhookId },
    select: { id: true, url: true, secret: true, events: true, board: { select: { id: true, name: true } } },
  });
  const actor = await db.user.findUnique({ where: { id: actorId }, select: userRefSelect });
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
  // Stored already claimed (one attempt, under lease), so the queue leaves it
  // alone unless this process stops before the result is recorded.
  const row = await db.webhookDelivery
    .create({
      data: {
        id: deliveryId,
        webhookId,
        event: TEST_EVENT,
        payload: body,
        attempts: 1,
        nextAttemptAt: new Date(Date.now() + LEASE_MS),
      },
      select: { id: true, webhookId: true },
    })
    .catch(() => null);
  if (!row) return { ok: false, status: null, durationMs: 0, error: "Webhook no longer exists." };
  const result = await send(hook.url, hook.secret, { webhookId, event: TEST_EVENT, deliveryId, body });
  await finish(db, row, 1, result);
  return result;
}
