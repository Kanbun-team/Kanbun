import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { guardedLookup, send } from "@/server/webhooks";
import { verifySignature } from "@/lib/webhooks";

let server: Server;
let port: number;
let last: { headers: IncomingHttpHeaders; body: string } | null = null;
let status = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      last = { headers: req.headers, body };
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

afterEach(() => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
  last = null;
  status = 200;
});

const job = { webhookId: "w1", event: "card.created", deliveryId: "d1", body: '{"event":"card.created"}' };

describe("webhook HTTP delivery", () => {
  it("refuses loopback targets by default, before connecting", async () => {
    const r = await send(`http://127.0.0.1:${port}/`, "s", job);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not allowed/);
    expect(last).toBeNull();
  });

  it("refuses host names that resolve to private addresses", async () => {
    const lookup = guardedLookup(false);
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      lookup("localhost", { all: true }, (e) => resolve(e))
    );
    expect(err?.code).toBe("EBLOCKED");
  });

  it("delivers a signed POST when private targets are allowed", async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = "1";
    const r = await send(`http://localhost:${port}/hook`, "secret", job);
    expect(r).toMatchObject({ ok: true, status: 200, error: null });
    expect(last?.body).toBe(job.body);
    expect(last?.headers["x-kanbun-event"]).toBe("card.created");
    expect(last?.headers["x-kanbun-delivery"]).toBe("d1");
    expect(verifySignature("secret", job.body, last?.headers["x-kanbun-signature"] as string)).toBe(true);
  });

  it("reports non-2xx answers as failures", async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = "1";
    status = 500;
    const r = await send(`http://127.0.0.1:${port}/`, "s", job);
    expect(r).toMatchObject({ ok: false, status: 500, error: "HTTP 500" });
  });
});
