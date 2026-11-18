import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

// Watchers and notification settings. Each test uses its own user or card so
// the order of specs does not matter.

async function openCard(page: Page, columnName: string, title: string) {
  await card(page, columnName, title).getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  const panel = page.getByRole("dialog", { name: "Open card" });
  await expect(panel.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  return panel;
}

async function openBell(page: Page) {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Notifications" }).click();
  return page.getByRole("list", { name: "Notifications" });
}

test("a watcher hears about comments, once even when also mentioned", async ({ page, browser }) => {
  const title = "Set up preview deployments";

  const julia = await browser.newPage();
  await loginAs(julia, "julia");
  await openDemoBoard(julia);
  const juliaPanel = await openCard(julia, "Done", title);
  await juliaPanel.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(juliaPanel.getByRole("button", { name: "Watching" })).toBeVisible();
  await expect(toast(julia)).toContainText("You are watching this card");

  await loginAs(page, "admin");
  await openDemoBoard(page);
  const panel = await openCard(page, "Done", title);
  const stamp = Date.now();
  await panel.getByLabel("Write a comment").fill(`Preview builds are green ${stamp}`);
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(panel.getByText(`Preview builds are green ${stamp}`)).toBeVisible();
  // Commenting makes the author a watcher.
  await expect(panel.getByRole("button", { name: "Watching" })).toBeVisible();

  let list = await openBell(julia);
  await expect(list.getByText(`Ada Admin commented on "${title}"`)).toHaveCount(1);

  // Mentioned and watching: one notification, the mention.
  await panel.getByLabel("Write a comment").fill(`Thanks @julia ${stamp}`);
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(panel.getByText(`Thanks @julia ${stamp}`)).toBeVisible();

  list = await openBell(julia);
  await expect(list.getByText(`Ada Admin mentioned you in "${title}"`)).toHaveCount(1);
  await expect(list.getByText(`Ada Admin commented on "${title}"`)).toHaveCount(1);
  await julia.close();
});

test("a board watcher hears about new cards", async ({ page, browser }) => {
  const piotr = await browser.newPage();
  await loginAs(piotr, "piotr");
  await openDemoBoard(piotr);
  await piotr.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(piotr.getByRole("button", { name: "Watching" })).toBeVisible();
  await piotr.reload();
  await expect(piotr.getByRole("button", { name: "Watching" })).toBeVisible();

  await loginAs(page, "admin");
  await openDemoBoard(page);
  const title = `Watched board card ${Date.now()}`;
  const backlog = column(page, "Backlog");
  await backlog.getByRole("button", { name: "Add card" }).click();
  await backlog.getByPlaceholder("Title").fill(title);
  await backlog.getByPlaceholder("Title").press("Enter");
  await expect(card(page, "Backlog", title)).toBeVisible();

  const list = await openBell(piotr);
  await expect(list.getByText(`Ada Admin added "${title}"`)).toBeVisible();

  // Stop watching again so other specs see the board as before.
  await openDemoBoard(piotr);
  await piotr.getByRole("button", { name: "Watching" }).click();
  await expect(piotr.getByRole("button", { name: "Watch", exact: true })).toBeVisible();
  await piotr.close();
});

test("notification preferences save and persist", async ({ page }) => {
  await loginAs(page, "tomek");
  await page.goto("/settings");
  const form = page.getByRole("form", { name: "Notifications" });
  await expect(form).toBeVisible();

  // No SMTP in the e2e environment: email options are off and explained.
  await expect(form.getByText(/Email is not set up on this server/)).toBeVisible();
  await expect(form.getByRole("radio", { name: "Comments on watched cards: In-app + email" })).toBeDisabled();
  await expect(form.getByRole("checkbox", { name: /Daily digest/ })).toBeDisabled();

  await expect(form.getByRole("radio", { name: "Comments on watched cards: In-app", exact: true })).toBeChecked();
  await form.getByRole("radio", { name: "Comments on watched cards: Off" }).check();
  await form.getByRole("radio", { name: "New cards on watched boards: Off" }).check();
  await form.getByLabel("Email address").fill("tomek@example.com");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(toast(page)).toContainText("Changes saved");

  await page.reload();
  const again = page.getByRole("form", { name: "Notifications" });
  await expect(again.getByRole("radio", { name: "Comments on watched cards: Off" })).toBeChecked();
  await expect(again.getByRole("radio", { name: "New cards on watched boards: Off" })).toBeChecked();
  await expect(again.getByRole("radio", { name: "Mentions: In-app", exact: true })).toBeChecked();
  await expect(again.getByLabel("Email address")).toHaveValue("tomek@example.com");

  expect(await axeViolations(page)).toEqual([]);
});
