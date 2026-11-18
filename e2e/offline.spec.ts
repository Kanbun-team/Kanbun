import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

// Offline-tolerant PWA: the service worker serves boards visited before, and
// card edits made offline are queued and synced on reconnect.

async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName);
  await col.getByRole("button", { name: "Add card" }).click();
  await col.getByPlaceholder("Title").fill(title);
  await col.getByPlaceholder("Title").press("Enter");
  await expect(card(page, columnName, title)).toBeVisible();
  await col.getByPlaceholder("Title").press("Escape");
}

async function renameCard(page: Page, columnName: string, from: string, to: string) {
  await card(page, columnName, from).getByRole("link").focus();
  await page.keyboard.press("e");
  const editor = page.getByLabel("Title");
  await editor.fill(to);
  await editor.press("Enter");
  await expect(card(page, columnName, to)).toBeVisible();
}

/** Waits until the service worker controls the page and has stored it. */
async function waitForOfflineCopy(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        for (const name of await caches.keys()) {
          if (name.startsWith("kanbun-pages-") && (await (await caches.open(name)).match(url))) return true;
        }
        return false;
      }, page.url())
    )
    .toBe(true);
}

const pending = (page: Page) => page.getByTestId("offline-pending");

test("a board visited before works offline, and edits sync on reconnect", async ({ page, context, browser }) => {
  const stamp = Date.now();
  const moved = `Offline move ${stamp}`;
  const renamed = `Offline rename ${stamp}`;
  await loginAs(page, "admin");
  await openDemoBoard(page);
  await addCard(page, "To do", moved);
  await addCard(page, "To do", renamed);
  await waitForOfflineCopy(page);

  await context.setOffline(true);
  await page.reload();
  await expect(card(page, "To do", moved)).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: "Offline: showing data from" });
  await expect(banner).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Move one card with the Move to dialog, rename the other.
  await card(page, "To do", moved).getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to" }).click();
  const dialog = page.getByRole("dialog");
  const select = dialog.getByLabel("Column");
  const review = await select.locator("option", { hasText: /^Review/ }).getAttribute("value");
  await select.selectOption(review!);
  await dialog.getByRole("button", { name: "Move card" }).click();
  await expect(card(page, "Review", moved)).toBeVisible();
  await renameCard(page, "To do", renamed, `${renamed} done`);
  await expect(pending(page)).toHaveText("2 changes waiting to sync");

  // Still there after an offline reload.
  await page.reload();
  await expect(card(page, "Review", moved)).toBeVisible();
  await expect(card(page, "To do", `${renamed} done`)).toBeVisible();
  await expect(pending(page)).toHaveText("2 changes waiting to sync");

  await context.setOffline(false);
  await expect(toast(page)).toContainText("All offline changes are synced.");
  await expect(pending(page)).toHaveCount(0);
  await expect(banner).toHaveCount(0);

  // Another browser sees the synced changes.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await loginAs(page2, "admin");
  await openDemoBoard(page2);
  await expect(card(page2, "Review", moved)).toBeVisible();
  await expect(card(page2, "To do", `${renamed} done`)).toBeVisible();
  await other.close();
});

test("a card added offline syncs together with later edits", async ({ page, context }) => {
  const title = `Offline new ${Date.now()}`;
  await loginAs(page, "admin");
  await openDemoBoard(page);
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();

  await addCard(page, "Backlog", title);
  await renameCard(page, "Backlog", title, `${title} edited`);
  await expect(pending(page)).toHaveText("2 changes waiting to sync");

  // Changes that need the server say so instead of failing.
  await column(page, "Backlog").getByRole("button", { name: "Actions for column Backlog" }).click();
  await page.getByRole("menuitem", { name: "Move right" }).click();
  await expect(toast(page)).toContainText("You are offline");

  await context.setOffline(false);
  await expect(pending(page)).toHaveCount(0);
  await page.reload();
  await expect(card(page, "Backlog", `${title} edited`)).toBeVisible();
  await expect(card(page, "Backlog", title).filter({ hasNotText: "edited" })).toHaveCount(0);
});

test("client navigation offline falls back to stored pages or the offline page", async ({ page, context }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  await waitForOfflineCopy(page);
  const boardUrl = page.url();
  await page.goto("/tasks/me");
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
  await page.goto(boardUrl);
  await expect(column(page, "To do")).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("navigation").getByRole("link", { name: "My tasks" }).first().click();
  await expect(page).toHaveURL(/\/tasks\/me$/);
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();

  await page.goto("/trash").catch(() => {});
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await context.setOffline(false);
});

test("a comment typed offline is kept and can be posted after reconnecting", async ({ page, context }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  await card(page, "Review", "Lighthouse pass").getByRole("link").click();
  const panel = page.getByRole("dialog");
  const body = `Written offline ${Date.now()}`;
  await expect(panel.getByLabel("Write a comment")).toBeVisible();
  await context.setOffline(true);
  await panel.getByLabel("Write a comment").fill(body);
  const post = panel.getByRole("button", { name: "Post comment" });
  await expect(post).toBeDisabled();
  await expect(panel.getByText("You are offline. Your comment stays here")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await context.setOffline(false);
  await expect(post).toBeEnabled();
  await expect(panel.getByLabel("Write a comment")).toHaveValue(body);
  await post.click();
  await expect(panel.getByText(body)).toBeVisible();
});

test("logging out deletes the offline copies", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  await waitForOfflineCopy(page);
  await page.getByRole("button", { name: "Ada Admin" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  const left = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith("kanbun-pages-"));
    const keys = await new Promise<number>((resolve) => {
      const req = indexedDB.open("kanbun-offline");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) return resolve(0);
        const r = db.transaction("kv").objectStore("kv").count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    });
    return { names, keys };
  });
  expect(left).toEqual({ names: [], keys: 0 });
});
