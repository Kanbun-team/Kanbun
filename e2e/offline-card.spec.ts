import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

// Card details stored for offline reading: a card opened online opens again
// offline from the stored copy (read-only, with queued edits), and cards
// never opened are readable from the board's lightweight copy.

/** All values in the offline IndexedDB store whose key starts with `prefix`, as JSON. */
function storedJson(page: Page, prefix: string) {
  return page.evaluate(
    (p) =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open("kanbun-offline");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) return resolve("");
          const store = db.transaction("kv").objectStore("kv");
          const out: unknown[] = [];
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) return resolve(JSON.stringify(out));
            if (String(c.key).startsWith(p)) out.push(c.value);
            c.continue();
          };
          cursor.onerror = () => resolve("");
        };
        req.onerror = () => resolve("");
      }),
    prefix
  );
}

const pending = (page: Page) => page.getByTestId("offline-pending");

test("a card opened online is readable offline, and checklist and comment edits sync", async ({ page, context, browser }) => {
  const stamp = Date.now();
  const title = `Offline card ${stamp}`;
  const step = `Offline step ${stamp}`;
  const comment = `Offline comment ${stamp}`;
  await loginAs(page, "admin");
  await openDemoBoard(page);

  const backlog = column(page, "Backlog");
  await backlog.getByRole("button", { name: "Add card" }).click();
  await backlog.getByPlaceholder("Title").fill(title);
  await backlog.getByPlaceholder("Title").press("Enter");
  await expect(card(page, "Backlog", title)).toBeVisible();
  await backlog.getByPlaceholder("Title").press("Escape");

  // Open it online and add a checklist item.
  await card(page, "Backlog", title).getByRole("link").click();
  const panel = page.getByRole("dialog", { name: "Open card" });
  await expect(panel.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await panel.getByRole("textbox", { name: "Add subtask" }).fill(step);
  await panel.getByRole("textbox", { name: "Add subtask" }).press("Enter");
  await expect(panel.getByRole("checkbox", { name: `Done: ${step}` })).toBeVisible();
  await expect.poll(() => storedJson(page, "card:")).toContain(step);
  // The board's lightweight copy of every card was fetched too.
  await expect.poll(() => storedJson(page, "bcards:")).toContain("Lighthouse pass on landing page");
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  const face = card(page, "Backlog", title);
  await expect(face).toContainText("0 of 1 subtask done");
  await expect(face).not.toContainText("1 comment");

  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Offline" }).first()).toBeVisible();
  await card(page, "Backlog", title).getByRole("link").click();
  const sheet = page.getByRole("dialog", { name: "Open card" });
  await expect(sheet.getByRole("status")).toContainText("Offline: read-only, from");
  await expect(sheet.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(page).not.toHaveURL(/\/cards\//);
  expect(await axeViolations(page)).toEqual([]);

  // Queue a checklist toggle and a new comment.
  await sheet.getByRole("checkbox", { name: `Done: ${step}` }).check();
  await expect(sheet.getByRole("checkbox", { name: `Done: ${step}` })).toBeChecked();
  await sheet.getByRole("textbox", { name: "Write a comment" }).fill(comment);
  await sheet.getByRole("button", { name: "Post comment" }).click();
  await expect(sheet.getByTestId("pending-comment")).toContainText(comment);
  await expect(sheet.getByTestId("pending-comment")).toContainText("Pending");
  expect(await axeViolations(page)).toEqual([]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(pending(page)).toHaveText("2 changes waiting to sync");
  // The board card shows the queued checklist tick and comment before syncing.
  await expect(face).toContainText("1 of 1 subtask done");
  await expect(face).toContainText("1 comment");

  // A card never opened: the lightweight copy.
  await card(page, "Review", "Lighthouse pass on landing page").getByRole("link").click();
  await expect(sheet.getByRole("status")).toContainText("Only a short copy of this card is stored");
  await expect(sheet.getByRole("textbox", { name: "Title" })).toHaveValue("Lighthouse pass on landing page");
  await sheet.getByRole("button", { name: "Close" }).click();

  await context.setOffline(false);
  await expect(toast(page)).toContainText("All offline changes are synced.");
  await expect(pending(page)).toHaveCount(0);
  await expect(face).toContainText("1 of 1 subtask done");
  await expect(face).toContainText("1 comment");

  // Another browser sees the synced checklist item and comment, posted once.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await loginAs(page2, "admin");
  await openDemoBoard(page2);
  await card(page2, "Backlog", title).getByRole("link").click();
  const panel2 = page2.getByRole("dialog", { name: "Open card" });
  await expect(panel2.getByRole("checkbox", { name: `Done: ${step}` })).toBeChecked();
  await expect(panel2.getByText(comment)).toHaveCount(1);
  await other.close();
});

test("the offline board copy of cards is only sent to board members", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const boardId = new URL(page.url()).pathname.split("/").pop();
  const res = await page.request.get(`/api/boards/${boardId}/offline`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.cards.length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toContain("passwordHash");

  const anon = await browser.newContext();
  const r2 = await anon.request.get(`/api/boards/${boardId}/offline`, { maxRedirects: 0 });
  expect(r2.ok()).toBe(false);
  await anon.close();
});

test("the full card page reloaded offline shows the stored details read-only", async ({ page, context }) => {
  const title = `Offline page ${Date.now()}`;
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const todo = column(page, "To do");
  await todo.getByRole("button", { name: "Add card" }).click();
  await todo.getByPlaceholder("Title").fill(title);
  await todo.getByPlaceholder("Title").press("Enter");
  await expect(card(page, "To do", title)).toBeVisible();
  await todo.getByPlaceholder("Title").press("Escape");
  await expect(card(page, "To do", title).getByRole("link")).toHaveAttribute("href", /\/cards\/[^/]+$/);
  const href = await card(page, "To do", title).getByRole("link").getAttribute("href");
  await page.goto(href!);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        if (!navigator.serviceWorker.controller) return false;
        for (const name of await caches.keys()) {
          if (name.startsWith("kanbun-pages-") && (await (await caches.open(name)).match(url))) return true;
        }
        return false;
      }, page.url())
    )
    .toBe(true);
  await expect.poll(() => storedJson(page, "card:")).toContain(title);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Offline: read-only, from" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(page.getByRole("button", { name: "Delete card" })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Delete card" })).toBeVisible();
});
