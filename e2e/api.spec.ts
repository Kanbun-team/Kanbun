import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, loginAs, openDemoBoard, toast } from "./helpers";

// REST API with personal access tokens, and board webhooks. The e2e server
// runs with WEBHOOK_ALLOW_PRIVATE=1 so webhooks can reach the receiver this
// test starts on localhost.

async function createToken(page: Page, name: string, scope: "Read only" | "Read and write"): Promise<string> {
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "API tokens" });
  await section.getByLabel("Token name").fill(name);
  await section.getByLabel("Access").selectOption({ label: scope });
  await section.getByRole("button", { name: "Create token" }).click();
  const field = section.getByLabel("Your new token");
  await expect(field).toBeVisible();
  const token = await field.inputValue();
  expect(token).toMatch(/^kbn_[0-9a-f]{64}$/);
  await section.getByRole("button", { name: "Done" }).click();
  await expect(section.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  return token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test("tokens: create in settings, use the API, read-only and revoked tokens", async ({ page, request }) => {
  await loginAs(page, "admin");
  const stamp = Date.now();
  const writeToken = await createToken(page, `Script ${stamp}`, "Read and write");
  const readToken = await createToken(page, `Reader ${stamp}`, "Read only");

  // No token, or a malformed one: 401 in the error shape.
  const anon = await request.get("/api/v1/boards");
  expect(anon.status()).toBe(401);
  expect((await anon.json()).error.code).toBe("unauthorized");
  expect((await request.get("/api/v1/boards", { headers: { Authorization: "Bearer nope" } })).status()).toBe(401);

  const me = await request.get("/api/v1/me", { headers: auth(writeToken) });
  expect(me.ok()).toBe(true);
  expect(await me.json()).toMatchObject({ username: "admin", token: { scope: "write" } });

  const boards = await request.get("/api/v1/boards?limit=100", { headers: auth(readToken) });
  expect(boards.ok()).toBe(true);
  expect(boards.headers()["x-ratelimit-limit"]).toBeTruthy();
  const list = (await boards.json()) as { data: { id: string; name: string }[]; next: string | null };
  const board = list.data.find((b) => b.name === "Website relaunch")!;
  expect(board).toBeTruthy();

  // Pagination: one per page with a cursor.
  const first = await (await request.get("/api/v1/boards?limit=1", { headers: auth(readToken) })).json();
  expect(first.data).toHaveLength(1);
  expect(first.next).toBeTruthy();
  const second = await (await request.get(`/api/v1/boards?limit=1&cursor=${first.next}`, { headers: auth(readToken) })).json();
  expect(second.data[0].id).not.toBe(first.data[0].id);

  const detail = await (await request.get(`/api/v1/boards/${board.id}`, { headers: auth(readToken) })).json();
  const todo = detail.columns.find((c: { name: string }) => c.name === "To do");
  const done = detail.columns.find((c: { name: string }) => c.name === "Done");
  expect(todo && done).toBeTruthy();

  // The read-only token can not write.
  const denied = await request.post(`/api/v1/boards/${board.id}/cards`, {
    headers: auth(readToken),
    data: { columnId: todo.id, title: "Nope" },
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe("insufficient_scope");

  // Validation errors are 422 with details.
  const invalid = await request.post(`/api/v1/boards/${board.id}/cards`, {
    headers: auth(writeToken),
    data: { columnId: todo.id, title: "" },
  });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).error.details[0].path).toBe("title");
  expect((await request.get(`/api/v1/cards/does-not-exist`, { headers: auth(readToken) })).status()).toBe(404);

  // Create a card and watch it appear on the open board.
  await openDemoBoard(page);
  const title = `From the API ${stamp}`;
  const createdRes = await request.post(`/api/v1/boards/${board.id}/cards`, {
    headers: auth(writeToken),
    data: { columnId: todo.id, title, priority: "high", deadline: "2030-01-15", position: 0 },
  });
  expect(createdRes.status()).toBe(201);
  const created = await createdRes.json();
  expect(created).toMatchObject({ title, priority: "high", deadline: "2030-01-15", columnId: todo.id, position: 0 });
  await expect(card(page, "To do", title)).toBeVisible();

  // Move it to Done.
  const moved = await request.patch(`/api/v1/cards/${created.id}`, {
    headers: auth(writeToken),
    data: { columnId: done.id, position: 0, title: `${title} (moved)` },
  });
  expect(moved.ok()).toBe(true);
  expect(await moved.json()).toMatchObject({ columnId: done.id, position: 0 });
  await expect(card(page, "Done", `${title} (moved)`)).toBeVisible();

  const filtered = await (
    await request.get(`/api/v1/boards/${board.id}/cards?column=${done.id}`, { headers: auth(readToken) })
  ).json();
  expect(filtered.data.map((c: { id: string }) => c.id)).toContain(created.id);

  const comment = await request.post(`/api/v1/cards/${created.id}/comments`, {
    headers: auth(writeToken),
    data: { body: "Posted by a script" },
  });
  expect(comment.status()).toBe(201);
  const comments = await (await request.get(`/api/v1/cards/${created.id}/comments`, { headers: auth(readToken) })).json();
  expect(comments.data.at(-1)).toMatchObject({ body: "Posted by a script", author: { username: "admin" } });

  // Delete goes to the trash.
  const deleted = await request.delete(`/api/v1/cards/${created.id}`, { headers: auth(writeToken) });
  expect(deleted.ok()).toBe(true);
  expect((await deleted.json()).trashId).toBeTruthy();
  await expect(card(page, "Done", `${title} (moved)`)).toHaveCount(0);

  // Revoke the write token: it stops working at once.
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "API tokens" });
  await section
    .getByRole("listitem")
    .filter({ hasText: `Script ${stamp}` })
    .getByRole("button", { name: /Revoke/ })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await expect(toast(page)).toContainText("Token revoked");
  await expect(section.getByText(`Script ${stamp}`)).toHaveCount(0);
  const revoked = await request.get("/api/v1/me", { headers: auth(writeToken) });
  expect(revoked.status()).toBe(401);

  const violations = await axeViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

test("unknown API paths answer JSON and the OpenAPI spec is public", async ({ request }) => {
  const res = await request.get("/api/v1/nope");
  expect(res.status()).toBe(404);
  expect((await res.json()).error.code).toBe("not_found");
  const spec = await request.get("/api/v1/openapi.json");
  expect(spec.ok()).toBe(true);
  expect((await spec.json()).openapi).toBe("3.1.0");
});

test("webhooks: add in board settings, send a test and receive signed card events", async ({ page, request }) => {
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await loginAs(page, "admin");
    const token = await createToken(page, `Hooks ${Date.now()}`, "Read and write");
    await openDemoBoard(page);
    const boardUrl = page.url();
    const boardId = boardUrl.split("/").pop()!;
    await page.goto(`${boardUrl}/settings`);

    const section = page.getByRole("region", { name: "Webhooks" });
    // Plain wrong URLs are refused.
    await section.getByLabel("Payload URL").fill("ftp://example.com/x");
    await section.getByRole("button", { name: "Add webhook" }).click();
    await expect(toast(page)).toContainText("Use a public http or https address.");

    const url = `http://127.0.0.1:${port}/hook`;
    await section.getByLabel("Payload URL").fill(url);
    await section.getByRole("checkbox", { name: "New comment" }).uncheck();
    await section.getByRole("button", { name: "Add webhook" }).click();
    const secretField = section.getByLabel("Signing secret");
    await expect(secretField).toBeVisible();
    const secret = await secretField.inputValue();
    expect(secret).toMatch(/^whsec_/);
    await section.getByRole("button", { name: "Done" }).click();

    const item = section.getByRole("listitem").filter({ hasText: url });
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: "Send test" }).click();
    await expect(toast(page)).toContainText("Test delivered (HTTP 200)");
    await expect.poll(() => received.length).toBeGreaterThan(0);
    const ping = received[0];
    expect(ping.headers["x-kanbun-event"]).toBe("ping");
    expect(ping.headers["x-kanbun-signature"]).toBe(
      "sha256=" + createHmac("sha256", secret).update(ping.body).digest("hex")
    );

    const violations = await axeViolations(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

    // A card created through the API is delivered as card.created.
    const detail = await (await request.get(`/api/v1/boards/${boardId}`, { headers: auth(token) })).json();
    const todo = detail.columns.find((c: { name: string }) => c.name === "To do");
    const title = `Hooked ${Date.now()}`;
    const res = await request.post(`/api/v1/boards/${boardId}/cards`, {
      headers: auth(token),
      data: { columnId: todo.id, title },
    });
    expect(res.status()).toBe(201);
    await expect.poll(() => received.find((r) => r.headers["x-kanbun-event"] === "card.created")).toBeTruthy();
    const delivery = received.find((r) => r.headers["x-kanbun-event"] === "card.created")!;
    const payload = JSON.parse(delivery.body);
    expect(payload).toMatchObject({ event: "card.created", board: { id: boardId }, card: { title }, actor: { username: "admin" } });
    expect(delivery.headers["x-kanbun-delivery"]).toBe(payload.id);
    expect(delivery.headers["x-kanbun-signature"]).toBe(
      "sha256=" + createHmac("sha256", secret).update(delivery.body).digest("hex")
    );

    // Comments were not subscribed to.
    await request.post(`/api/v1/cards/${payload.card.id}/comments`, { headers: auth(token), data: { body: "hi" } });
    await request.delete(`/api/v1/cards/${payload.card.id}`, { headers: auth(token) });
    await expect.poll(() => received.some((r) => r.headers["x-kanbun-event"] === "card.deleted")).toBe(true);
    expect(received.some((r) => r.headers["x-kanbun-event"] === "comment.created")).toBe(false);

    const events = (name: string) =>
      received.filter((r) => r.headers["x-kanbun-event"] === name).map((r) => JSON.parse(r.body));

    // A reorder within a column is a card.updated with "position"; card.moved
    // is only for another column.
    const colRes = await request.post(`/api/v1/boards/${boardId}/columns`, { headers: auth(token), data: { name: `Hooks ${Date.now()}` } });
    expect(colRes.status()).toBe(201);
    const column = await colRes.json();
    const ids: string[] = [];
    for (const t of [`First ${Date.now()}`, `Second ${Date.now()}`]) {
      const r = await request.post(`/api/v1/boards/${boardId}/cards`, { headers: auth(token), data: { columnId: column.id, title: t } });
      ids.push((await r.json()).id);
    }
    await request.patch(`/api/v1/cards/${ids[1]}`, { headers: auth(token), data: { position: 0 } });
    await expect.poll(() => events("card.updated").some((p) => p.card.id === ids[1])).toBe(true);
    expect(events("card.updated").find((p) => p.card.id === ids[1]).changes).toEqual(["position"]);
    expect(events("card.moved").some((p) => p.card.id === ids[1])).toBe(false);
    await request.patch(`/api/v1/cards/${ids[0]}`, { headers: auth(token), data: { columnId: todo.id } });
    await request.patch(`/api/v1/cards/${ids[0]}`, { headers: auth(token), data: { columnId: column.id } });
    await expect.poll(() => events("card.moved").filter((p) => p.card.id === ids[0]).length).toBe(2);

    // Deleting the column sends card.deleted for each of its cards.
    expect((await request.delete(`/api/v1/columns/${column.id}`, { headers: auth(token) })).status()).toBe(200);
    await expect.poll(() => events("card.deleted").filter((p) => ids.includes(p.card.id)).length).toBe(2);
    for (const p of events("card.deleted").filter((e) => ids.includes(e.card.id))) {
      expect(p).toMatchObject({ reason: "column.deleted", column: { columnId: column.id, columnName: column.name } });
      expect(p.card.title).toMatch(/^(First|Second) /);
      expect(p.card.trashId).toBeTruthy();
    }

    // Clean up so other tests do not post to a closed port.
    await page.reload();
    await item.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(toast(page)).toContainText("Webhook deleted");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
