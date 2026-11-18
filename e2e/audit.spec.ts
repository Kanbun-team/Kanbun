import { expect, test, type Page } from "@playwright/test";
import { axeViolations, login, loginAs } from "./helpers";

async function setRole(page: Page, username: string, role: "Admin" | "Member") {
  await page.goto("/admin/users");
  const row = page.getByRole("listitem").filter({ hasText: `@${username}` });
  await row.locator("summary").click();
  await row.getByLabel("Role").selectOption({ label: role });
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
}

test("audit log shows sign-ins and role changes, with filters", async ({ page, browser }) => {
  // A failed sign-in from another browser, recorded with the username tried.
  const other = await browser.newPage();
  await login(other, "julia", "wrong-password");
  await expect(other.getByText("Invalid username or password.")).toBeVisible();
  await other.close();

  await loginAs(page, "admin");
  await setRole(page, "julia", "Admin");
  await setRole(page, "julia", "Member");

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "Audit log" });
  const signIn = table.getByRole("row").filter({ hasText: "Signed in" }).first();
  await expect(signIn).toContainText("admin");
  const failed = table.getByRole("row").filter({ hasText: "Failed sign-in" }).first();
  await expect(failed).toContainText("julia");
  const roleChange = table.getByRole("row").filter({ hasText: "Role changed" }).first();
  await expect(roleChange).toContainText("julia");
  await roleChange.getByText("Show details").click();
  await expect(roleChange.getByText("from")).toBeVisible();

  await page.getByLabel("Action").selectOption({ label: "Role changed" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/action=user\.role/);
  await expect(table.getByRole("row").filter({ hasText: "Signed in" })).toHaveCount(0);
  await expect(table.getByRole("row").filter({ hasText: "Role changed" })).toHaveCount(2);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^kanbun-audit-.*\.csv$/);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`audit page passes axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await loginAs(page, "admin");
    await page.goto("/admin/audit");
    await page.getByText("Show details").first().click();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("audit page works at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "admin");
  await page.goto("/admin/audit");
  await expect(page.getByRole("table", { name: "Audit log" }).getByText("Signed in").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await axeViolations(page)).toEqual([]);
});
