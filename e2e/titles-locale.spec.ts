import { expect, test } from "@playwright/test";
import { axeViolations, card, loginAs, openDemoBoard } from "./helpers";

test.describe("login screen in the browser's language", () => {
  test.use({ locale: "pl-PL" });

  test("Polish browser gets a Polish login screen and errors", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Zaloguj się · Kanbun");
    await expect(page.locator("html")).toHaveAttribute("lang", /pl/);
    await page.getByLabel("Nazwa użytkownika").fill("admin");
    await page.getByLabel("Hasło").fill("wrong-password");
    await page.getByRole("button", { name: "Zaloguj", exact: true }).click();
    await expect(page.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("login screen fallback", () => {
  test.use({ locale: "fr-FR" });

  test("an unsupported language falls back to English", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Log in · Kanbun");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });
});

test("every page has its own document title", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page).toHaveTitle("Boards · Kanbun");
  await page.goto("/tasks/me");
  await expect(page).toHaveTitle("My tasks · Kanbun");
  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings · Kanbun");
  await page.goto("/trash");
  await expect(page).toHaveTitle("Trash · Kanbun");
  await page.goto("/whats-new");
  await expect(page).toHaveTitle("What's new · Kanbun");
  await page.goto("/admin/users");
  await expect(page).toHaveTitle("Users · Kanbun");
  await page.goto("/users/marta");
  await expect(page).toHaveTitle("Marta Nowak · Kanbun");
  await page.goto("/no-such-page");
  await expect(page).toHaveTitle("Page not found · Kanbun");

  await openDemoBoard(page);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  const boardUrl = page.url();

  // The card panel over the board, and the card page on its own.
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  await expect(page).toHaveTitle("Responsive navigation · Website relaunch · Kanbun");
  // Closing the panel brings the board's title back.
  await page.keyboard.press("Escape");
  await page.waitForURL(boardUrl);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.waitForURL(boardUrl);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  await page.reload();
  await expect(page).toHaveTitle("Responsive navigation · Website relaunch · Kanbun");

  await page.goto(`${boardUrl}/settings`);
  await expect(page).toHaveTitle("Board settings · Website relaunch · Kanbun");
});
