import { expect, test } from "@playwright/test";
import { axeViolations } from "./helpers";

// First-run setup on an empty database (the "setup" project's own server,
// see playwright.config.ts). One test walks the whole flow, since setup can
// only happen once per database.

test("first run: create the admin in the browser, then a first board from a template", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Welcome! Create the admin account" })).toBeVisible();
  let violations = await axeViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Display name (optional)").fill("Olga Owner");
  await page.getByLabel("Password", { exact: true }).fill("secret12");
  await page.getByLabel("Confirm password").fill("secret13");
  await page.getByRole("button", { name: "Create admin account" }).click();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue("owner");

  await page.getByLabel("Password", { exact: true }).fill("secret12");
  await page.getByLabel("Confirm password").fill("secret12");
  await page.getByRole("button", { name: "Create admin account" }).click();
  await page.waitForURL(/\/setup\/board$/);
  await expect(page.getByRole("heading", { name: "Create your first board" })).toBeVisible();
  violations = await axeViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

  await page.getByLabel("Board name").fill("Engineering");
  await page.getByRole("radio", { name: /Software/ }).check();
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  for (const name of ["Backlog", "Ready", "In progress", "Review", "Done"]) {
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  }
  // The empty board teaches the first steps.
  await expect(page.getByText("This board has no cards yet")).toBeVisible();
  await page.getByRole("button", { name: "Add a card to Backlog" }).click();
  await expect(page.getByRole("region", { name: "Backlog", exact: true }).getByRole("textbox", { name: "Title" })).toBeFocused();

  // Setup is closed for good once an account exists.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/tasks$/);
  await page.context().clearCookies();
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
});
