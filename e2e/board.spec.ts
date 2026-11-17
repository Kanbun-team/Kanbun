import { expect, test } from "@playwright/test";
import { card, column, drag, loginAs, openDemoBoard, toast } from "./helpers";

test.beforeEach(async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
});

test("add a card, drag it, delete it and undo", async ({ page }) => {
  const title = `E2E card ${Date.now()}`;
  const todo = column(page, "To do");
  await todo.getByRole("button", { name: "Add card" }).click();
  await todo.getByPlaceholder("Title").fill(title);
  await todo.getByPlaceholder("Title").press("Enter");
  await expect(card(page, "To do", title)).toBeVisible();

  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await drag(page, card(page, "To do", title), column(page, "Review"));
  await saved;
  await expect(card(page, "Review", title)).toBeVisible();
  await page.reload();
  await expect(card(page, "Review", title)).toBeVisible();

  await card(page, "Review", title).getByRole("link").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await expect(toast(page)).toContainText("Card deleted");
  await expect(card(page, "Review", title)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "Review", title)).toBeVisible();
});

test("paste several lines to add several cards", async ({ page }) => {
  const stamp = Date.now();
  const backlog = column(page, "Backlog");
  await backlog.getByRole("button", { name: "Add card" }).click();
  await backlog.getByPlaceholder("Title").fill(`Line one ${stamp}\nLine two ${stamp}`);
  await backlog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card(page, "Backlog", `Line one ${stamp}`)).toBeVisible();
  await expect(card(page, "Backlog", `Line two ${stamp}`)).toBeVisible();
});

test("move a card with the keyboard only", async ({ page }) => {
  const link = card(page, "Backlog", "Dark mode for docs").getByRole("link");
  await link.focus();
  const live = page.locator("[id^=DndLiveRegion]");
  await page.keyboard.press("Space");
  await expect(live).toContainText("Dark mode for docs is in Backlog");
  await page.keyboard.press("ArrowRight");
  await expect(live).toContainText("is in To do");
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await page.keyboard.press("Space");
  await saved;
  await expect(card(page, "To do", "Dark mode for docs")).toBeVisible();
  await page.reload();
  await expect(card(page, "To do", "Dark mode for docs")).toBeVisible();
});

test("move a card with the Move to dialog", async ({ page }) => {
  await card(page, "Review", "Brand color tokens").getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Column").selectOption({ label: "Done (3)" });
  await dialog.getByLabel("Top").check();
  await dialog.getByRole("button", { name: "Move card" }).click();
  await expect(column(page, "Done").locator("[data-card-id]").first()).toContainText("Brand color tokens");
});

test("delete a column with its cards and restore it", async ({ page }) => {
  await expect(card(page, "Backlog", "Pricing page FAQ copy")).toBeVisible();
  await column(page, "Backlog").getByRole("button", { name: "Actions for column Backlog" }).click();
  await page.getByRole("menuitem", { name: "Delete column" }).click();
  await expect(toast(page)).toContainText('Column "Backlog" deleted');
  await expect(column(page, "Backlog")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "Backlog", "Pricing page FAQ copy")).toBeVisible();
});

test("reorder columns from the column menu", async ({ page }) => {
  const names = () => page.locator("[data-column-id]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect((await names()).slice(0, 2)).toEqual(["Backlog", "To do"]);
  await column(page, "Backlog").getByRole("button", { name: "Actions for column Backlog" }).click();
  await page.getByRole("menuitem", { name: "Move right" }).click();
  await expect.poll(async () => (await names()).slice(0, 2)).toEqual(["To do", "Backlog"]);
  await page.reload();
  await expect.poll(async () => (await names()).slice(0, 2)).toEqual(["To do", "Backlog"]);
  await column(page, "Backlog").getByRole("button", { name: "Actions for column Backlog" }).click();
  await page.getByRole("menuitem", { name: "Move left" }).click();
  await expect.poll(async () => (await names()).slice(0, 2)).toEqual(["Backlog", "To do"]);
});

test("keyboard shortcuts: help, search and rename", async ({ page }) => {
  await page.locator("body").press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("body").press("/");
  await expect(page.getByLabel(/search/i)).toBeFocused();
  await page.keyboard.press("Escape");

  const link = card(page, "To do", "Newsletter signup endpoint").getByRole("link");
  await link.focus();
  await page.keyboard.press("e");
  const editor = page.getByLabel("Title");
  await editor.fill("Newsletter signup API");
  await editor.press("Enter");
  await expect(card(page, "To do", "Newsletter signup API")).toBeVisible();
  await page.reload();
  await expect(card(page, "To do", "Newsletter signup API")).toBeVisible();
});

test("filter cards by text", async ({ page }) => {
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel(/search/i).fill("navigation");
  await expect(page.getByRole("link", { name: /Responsive navigation/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Hero section illustrations/ })).toHaveCount(0);
});

test("a card opens in a side panel over the board", async ({ page }) => {
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await expect(page).toHaveURL(/\/cards\//);
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Website relaunch, In progress")).toBeVisible();
  await expect(column(page, "To do")).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("comment with a mention notifies the mentioned member", async ({ page, browser }) => {
  await card(page, "Review", "Lighthouse pass").getByRole("link").click();
  const body = `Looks good @julia, shipping it ${Date.now()}`;
  await page.getByLabel("Write a comment").fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText(body)).toBeVisible();

  const julia = await browser.newPage();
  await loginAs(julia, "julia");
  await julia.getByRole("button", { name: /notifications/i }).click();
  await expect(julia.getByText(/mentioned you/i).first()).toBeVisible();
  await julia.close();
});

test("delete a card from its panel, then restore it from the trash", async ({ page }) => {
  await card(page, "Done", "Kickoff workshop notes").getByRole("link").click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete card" }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toast(page)).toContainText("Card deleted");
  await expect(card(page, "Done", "Kickoff workshop notes")).toHaveCount(0);

  await page.goto("/trash");
  const row = page.getByRole("listitem").filter({ hasText: "Kickoff workshop notes" });
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(toast(page)).toContainText("Restored");
  await openDemoBoard(page);
  await expect(card(page, "Done", "Kickoff workshop notes")).toBeVisible();
});
