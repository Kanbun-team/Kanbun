import { expect, test } from "@playwright/test";
import { login, loginAs } from "./helpers";

test("deactivated users cannot log in until reactivated", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await page.goto("/admin/users");
  const row = page.getByRole("listitem").filter({ hasText: "@piotr" });
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Deactivate" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("status")).toContainText("deactivated");
  await expect(row.getByText("Deactivated")).toBeVisible();

  const other = await browser.newPage();
  await login(other, "piotr");
  await expect(other.getByText("Invalid username or password.")).toBeVisible();
  await expect(other).toHaveURL(/\/login/);

  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("status")).toContainText("reactivated");
  await login(other, "piotr");
  await expect(other).toHaveURL(/\/tasks/);
  await other.close();
});

test("deleting a board moves it to the trash and it can be restored", async ({ page }) => {
  await loginAs(page, "admin");
  await page.getByRole("link", { name: /Hiring/ }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await page.goto(`${page.url()}/settings`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("status")).toContainText("Board deleted");
  await expect(page.getByRole("link", { name: /Hiring/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: /Hiring/ }).first()).toBeVisible();
});
