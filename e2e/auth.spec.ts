import { expect, test } from "@playwright/test";
import { login, loginAs } from "./helpers";

test("wrong password shows an error and stays on login", async ({ page }) => {
  await login(page, "admin", "wrong-password");
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("admin logs in and sees the boards", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page.getByRole("link", { name: /Website relaunch/ }).first()).toBeVisible();
});

test("members cannot open the admin area or board settings they don't own", async ({ page }) => {
  await loginAs(page, "julia");
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/tasks$/);
  await page.goto("/tasks");
  await page.getByRole("link", { name: /Website relaunch/ }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  const boardUrl = page.url();
  await page.goto(`${boardUrl}/settings`);
  await expect(page).toHaveURL(boardUrl);
});
