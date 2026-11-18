import { expect, test } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

// Card templates and repeating schedules, managed in board settings.

test("create a template in settings, then a card from it with checklist and tags", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const boardUrl = page.url();
  await page.goto(`${boardUrl}/settings`);

  const section = page.getByRole("region", { name: "Card templates" });
  await section.getByText("New template").click();
  // The demo board has templates already; fill in the new-template form.
  const form = section.locator("details").filter({ has: page.getByText("New template", { exact: true }) });
  const name = `Bug report ${Date.now()}`;
  await form.getByLabel("Template name").fill(name);
  await form.getByLabel("Card title").fill("Fix: describe the bug");
  await form.getByLabel("Description").fill("Steps to reproduce:");
  await form.getByLabel("Priority").selectOption({ label: "High" });
  await form.getByRole("checkbox", { name: "Bug" }).check();
  await form.getByLabel("Checklist").fill("Reproduce it\nWrite a test\n\nShip the fix");
  await form.getByRole("button", { name: "Create template" }).click();
  await expect(toast(page)).toContainText("Template created");
  await expect(section.getByText(name)).toBeVisible();
  await expect(section.getByText("3 checklist items")).toBeVisible();

  // A schedule built on it reads back in words.
  const repeat = page.getByRole("region", { name: "Repeat" });
  await repeat.getByLabel("Template").selectOption({ label: name });
  await repeat.getByLabel("Add to column").selectOption({ label: "To do" });
  await repeat.getByLabel("Repeats").selectOption({ label: "Every month" });
  await repeat.getByLabel("Day of the month").selectOption("31");
  await expect(repeat.getByText("Monthly on the 31st")).toBeVisible();
  await expect(repeat.getByText("In shorter months it runs on the last day.")).toBeVisible();
  await repeat.getByLabel("Repeats").selectOption({ label: "Every week" });
  await repeat.getByLabel("Day of the week").selectOption({ label: "Monday" });
  await repeat.getByRole("button", { name: "Add schedule" }).click();
  await expect(toast(page)).toContainText("Schedule added");
  await expect(repeat.getByRole("listitem").filter({ hasText: name }).getByText("Every Monday", { exact: true })).toBeVisible();

  const violations = await axeViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

  // Use it from the column.
  await page.goto(boardUrl);
  await column(page, "To do").getByRole("button", { name: "New card from template in To do" }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(toast(page)).toContainText(`Card created from ${name} in To do`);
  const created = card(page, "To do", "Fix: describe the bug");
  await expect(created).toHaveCount(1);
  await expect(created).toContainText("Bug");

  await created.getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  const panel = page.getByRole("dialog", { name: "Open card" });
  await expect(panel.getByText("Reproduce it")).toBeVisible();
  await expect(panel.getByText("Write a test")).toBeVisible();
  await expect(panel.getByText("Ship the fix")).toBeVisible();
  await expect(panel.getByText("Steps to reproduce:")).toBeVisible();
  await expect(panel.getByText(`from the template ${name}`)).toBeVisible();
});

test("save a card as a template from its menu", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const source = card(page, "Backlog", "Pricing page FAQ copy");
  await source.hover();
  await source.getByRole("button", { name: "Actions for Pricing page FAQ copy" }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
  await expect(toast(page)).toContainText("Saved as template “Pricing page FAQ copy”");

  await column(page, "Review").getByRole("button", { name: "New card from template in Review" }).click();
  await expect(page.getByRole("menuitem", { name: "Pricing page FAQ copy" })).toBeVisible();
  await page.keyboard.press("Escape");
});
