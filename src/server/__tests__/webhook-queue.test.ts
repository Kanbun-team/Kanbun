import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { queueBoardEvent, runWebhookQueue, sendTestDelivery } from "@/server/webhooks";
import { WEBHOOK_FAILURE_LIMIT, WEBHOOK_HISTORY, verifySignature } from "@/lib/webhooks";
import { createTestDb } from "./test-db";

// The durable webhook outbox: rows in WebhookDelivery, claimed atomically,
// retried with backoff and pruned to the history limit.

let db: PrismaClient;
let url: string;
let cleanup: () => Promise<void>;
let server: Server;
let port: number;
let received: { headers: IncomingHttpHeaders; body: string }[] = [];
let status = 200;
let delayMs = 0;
let boardId: string;
let cardId: string;
let userId: string;
let hookId: string;
const SECRET = "whsec_test";

beforeAll(async () => {
  process.env.WEBHOOK_ALLOW_PRIVATE = "1";
  ({ db, url, cleanup } = createTestDb());
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      setTimeout(() => res.writeHead(status).end(), delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  userId = (await db.user.create({ data: { username: "ada", passwordHash: "x", role: "admin" } })).id;
}, 60_000);

afterAll(async () => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  await new Promise((resolve) => server.close(resolve));
  await cleanup();
});

beforeEach(async () => {
  received = [];
  status = 200;
  delayMs = 0;
  await db.board.deleteMany();
  const board = await db.board.create({
    data: { name: "Ops", columns: { create: [{ name: "To do", position: 0 }] } },
    include: { columns: true },
  });
  boardId = board.id;
  cardId = (await db.taskCard.create({ data: { title: "Ship it", columnId: board.columns[0].id, position: 0 } })).id;
  hookId = (
    await db.webhook.create({
      data: { boardId, url: `http://127.0.0.1:${port}/hook`, secret: SECRET, events: JSON.stringify(["card.created"]) },
    })
  ).id;
});

const rows = () => db.webhookDelivery.findMany({ where: { webhookId: hookId }, orderBy: { createdAt: "asc" } });
/** Makes every pending delivery due now, as if the backoff had passed. */
const makeDue = () =>
  db.webhookDelivery.updateMany({ where: { status: "pending" }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

describe("webhook outbox", () => {
  it("stores the delivery, sends it signed and records success", async () => {
    expect(await queueBoardEvent(db, boardId, "card.created", { cardId, actorId: userId })).toBe(1);
    await runWebhookQueue(db);

    expect(received).toHaveLength(1);
    const [req] = received;
    const [row] = await rows();
    expect(row.status).toBe("success");
    expect(row.success).toBe(true);
    expect(row.attempts).toBe(1);
    expect(row.payload).toBeNull();
    expect(req.headers["x-kanbun-delivery"]).toBe(row.id);
    expect(req.headers["x-kanbun-event"]).toBe("card.created");
    expect(verifySignature(SECRET, req.body, String(req.headers["x-kanbun-signature"]))).toBe(true);
    expect(JSON.parse(req.body)).toMatchObject({ event: "card.created", id: row.id, card: { id: cardId } });
    const hook = await db.webhook.findUniqueOrThrow({ where: { id: hookId } });
    expect(hook.lastStatus).toBe(200);
    expect(hook.failureCount).toBe(0);
  });

  it("skips webhooks not subscribed to the event", async () => {
    expect(await queueBoardEvent(db, boardId, "card.moved", { cardId })).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("survives a restart: pending rows are sent by the next run", async () => {
    const body = JSON.stringify({ event: "card.created", id: "left-over" });
    await db.webhookDelivery.create({
      data: { id: "left-over", webhookId: hookId, event: "card.created", payload: body, nextAttemptAt: new Date() },
    });
    await runWebhookQueue(db);
    expect(received.map((r) => r.body)).toEqual([body]);
    expect((await rows())[0].status).toBe("success");
  });

  it("retries 5xx with backoff, then fails after 3 attempts", async () => {
    status = 503;
    await queueBoardEvent(db, boardId, "card.created", { cardId });
    await runWebhookQueue(db);
    let [row] = await rows();
    expect(row).toMatchObject({ status: "pending", attempts: 1, statusCode: 503, error: "HTTP 503" });
    expect(row.payload).not.toBeNull();
    const wait = row.nextAttemptAt!.getTime() - Date.now();
    expect(wait).toBeGreaterThan(3_000);
    expect(wait).toBeLessThanOrEqual(5_000);

    // Not due yet: nothing happens.
    await runWebhookQueue(db);
    expect(received).toHaveLength(1);

    await makeDue();
    await runWebhookQueue(db);
    [row] = await rows();
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
    expect(row.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(25_000);

    await makeDue();
    await runWebhookQueue(db);
    [row] = await rows();
    expect(row).toMatchObject({ status: "failed", attempts: 3, success: false, statusCode: 503, payload: null });
    expect(received).toHaveLength(3);
    // The same delivery id on every attempt, so receivers can drop duplicates.
    expect(new Set(received.map((r) => r.headers["x-kanbun-delivery"])).size).toBe(1);
    expect((await db.webhook.findUniqueOrThrow({ where: { id: hookId } })).failureCount).toBe(1);
  });

  it("does not retry client errors", async () => {
    status = 410;
    await queueBoardEvent(db, boardId, "card.created", { cardId });
    await runWebhookQueue(db);
    expect((await rows())[0]).toMatchObject({ status: "failed", attempts: 1, statusCode: 410 });
  });

  it("does not send to a webhook switched off meanwhile", async () => {
    await db.webhookDelivery.create({
      data: { webhookId: hookId, event: "card.created", payload: "{}", nextAttemptAt: new Date() },
    });
    await db.webhook.update({ where: { id: hookId }, data: { active: false } });
    await runWebhookQueue(db);
    expect(received).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ status: "failed", attempts: 0, error: "Not sent." });
  });

  it("never sends one delivery twice when workers race", async () => {
    // Two clients on the same database, like two instances.
    const other = new PrismaClient({ datasources: { db: { url } } });
    try {
      delayMs = 50;
      for (let i = 0; i < 6; i++) await queueBoardEvent(db, boardId, "card.created", { cardId });
      await Promise.all([runWebhookQueue(db), runWebhookQueue(other), runWebhookQueue(other)]);
      expect(received).toHaveLength(6);
      expect(new Set(received.map((r) => r.headers["x-kanbun-delivery"])).size).toBe(6);
      expect((await rows()).every((r) => r.status === "success" && r.attempts === 1)).toBe(true);
    } finally {
      await other.$disconnect();
    }
  });

  it("sends again after a worker died mid-send (at-least-once)", async () => {
    // Claimed (attempts 1, lease) but never recorded; the lease has run out.
    await db.webhookDelivery.create({
      data: {
        webhookId: hookId,
        event: "card.created",
        payload: "{}",
        attempts: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
    await runWebhookQueue(db);
    expect(received).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "success", attempts: 2 });
  });

  it("marks a delivery whose last attempt was interrupted as failed", async () => {
    await db.webhookDelivery.create({
      data: { webhookId: hookId, event: "card.created", payload: "{}", attempts: 3, nextAttemptAt: new Date(0) },
    });
    await runWebhookQueue(db);
    expect(received).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ status: "failed", attempts: 3, error: "Interrupted." });
  });

  it("switches the webhook off after the failure limit", async () => {
    status = 404;
    await db.webhook.update({ where: { id: hookId }, data: { failureCount: WEBHOOK_FAILURE_LIMIT - 1 } });
    await queueBoardEvent(db, boardId, "card.created", { cardId });
    await runWebhookQueue(db);
    expect((await db.webhook.findUniqueOrThrow({ where: { id: hookId } })).active).toBe(false);
  });

  it("keeps only the last finished deliveries, and every pending one", async () => {
    const old = Date.now() - 60_000;
    await db.webhookDelivery.createMany({
      data: Array.from({ length: WEBHOOK_HISTORY + 5 }, (_, i) => ({
        webhookId: hookId,
        event: "card.created",
        status: "success",
        success: true,
        attempts: 1,
        createdAt: new Date(old + i),
      })),
    });
    await db.webhookDelivery.create({
      data: { webhookId: hookId, event: "card.created", payload: "{}", nextAttemptAt: new Date(Date.now() + 60_000) },
    });
    await queueBoardEvent(db, boardId, "card.created", { cardId });
    await runWebhookQueue(db);
    const all = await rows();
    expect(all.filter((r) => r.status !== "pending")).toHaveLength(WEBHOOK_HISTORY);
    expect(all.filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("Send test delivers one ping at once and records it", async () => {
    status = 500;
    const result = await sendTestDelivery(hookId, userId, db);
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body)).toMatchObject({ event: "ping", webhook: { id: hookId } });
    // Tried once, no retry left behind.
    expect((await rows())[0]).toMatchObject({ event: "ping", status: "failed", attempts: 1 });
    await makeDue();
    await runWebhookQueue(db);
    expect(received).toHaveLength(1);
  });
});
