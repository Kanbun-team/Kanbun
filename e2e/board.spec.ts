import { expect, test } from "@playwright/test";
import { column, loginAs, openDemoBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
});

test("add a card, move it, delete it and undo", async ({ page }) => {
  const title = `E2E card ${Date.now()}`;
  const todo = column(page, "To do");
  await todo.getByRole("button", { name: "Add card" }).click();
  await todo.getByPlaceholder("Title").fill(title);
  await todo.getByPlaceholder("Title").press("Enter");
  await expect(todo.getByRole("link", { name: title })).toBeVisible();

  // Drag to Review and check the move survives a reload.
  await todo.getByRole("link", { name: title }).dragTo(column(page, "Review"));
  await expect(column(page, "Review").getByRole("link", { name: title })).toBeVisible();
  await page.reload();
  await expect(column(page, "Review").getByRole("link", { name: title })).toBeVisible();

  // Delete from the context menu, then undo from the toast.
  await column(page, "Review").getByRole("link", { name: title }).click({ button: "right" });
  await page.getByRole("button", { name: "Delete card" }).click();
  await expect(page.getByRole("status")).toContainText("Card deleted");
  await expect(column(page, "Review").getByRole("link", { name: title })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(column(page, "Review").getByRole("link", { name: title })).toBeVisible();
});

test("delete a column with its cards and restore it", async ({ page }) => {
  const backlog = column(page, "Backlog");
  await expect(backlog.getByRole("link", { name: "Pricing page FAQ copy" })).toBeVisible();
  await backlog.getByRole("button", { name: "Delete column: Backlog" }).click();
  await expect(page.getByRole("status")).toContainText('Column "Backlog" deleted');
  await expect(column(page, "Backlog")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(column(page, "Backlog").getByRole("link", { name: "Pricing page FAQ copy" })).toBeVisible();
});

test("filter cards by text", async ({ page }) => {
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByPlaceholder(/search/i).fill("navigation");
  await expect(page.getByRole("link", { name: "Responsive navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hero section illustrations" })).toHaveCount(0);
});

test("comment with a mention notifies the mentioned member", async ({ page, browser }) => {
  await column(page, "Review").getByRole("link", { name: "Brand color tokens" }).click();
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

test("delete a card from its page, then restore it from the trash", async ({ page }) => {
  await column(page, "Done").getByRole("link", { name: "Kickoff workshop notes" }).click();
  await page.getByRole("button", { name: "Delete card" }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  await expect(page.getByRole("status")).toContainText("Card deleted");
  await expect(column(page, "Done").getByRole("link", { name: "Kickoff workshop notes" })).toHaveCount(0);

  await page.goto("/trash");
  const row = page.getByRole("listitem").filter({ hasText: "Kickoff workshop notes" });
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toContainText("Restored");
  await openDemoBoard(page);
  await expect(column(page, "Done").getByRole("link", { name: "Kickoff workshop notes" })).toBeVisible();
});
