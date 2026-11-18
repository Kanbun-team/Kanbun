import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
// The demo seed sets deadlines relative to the moment it ran (UTC date).
const dayKey = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function switchView(page: Page, name: "Board" | "List" | "Calendar") {
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name }).click();
}

const listRows = (page: Page) => page.getByRole("region", { name: "Cards on this board" }).locator("tbody tr");

test.describe("board views", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await openDemoBoard(page);
  });

  test("list view: sort by deadline and open a card", async ({ page }) => {
    await switchView(page, "List");
    await expect(page).toHaveURL(/[?&]view=list/);
    const deadlineHeader = page.getByRole("columnheader", { name: "Deadline" });
    await expect(deadlineHeader).toHaveAttribute("aria-sort", "none");

    await deadlineHeader.getByRole("button").click();
    await expect(deadlineHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(listRows(page).first()).toContainText("Contact form spam protection");
    await expect(listRows(page).first().locator("td").nth(5).locator("span[title]")).toHaveAttribute("title", /\d{4}/);

    await deadlineHeader.getByRole("button").press("Enter");
    await expect(deadlineHeader).toHaveAttribute("aria-sort", "descending");
    await expect(listRows(page).first()).toContainText("Newsletter");

    // The view survives a reload.
    await page.reload();
    await expect(page.getByRole("radio", { name: "List" })).toBeChecked();

    await page.getByRole("link", { name: "Responsive navigation" }).click();
    await expect(page).toHaveURL(/\/cards\//);
    await expect(page.getByRole("dialog").getByText("Website relaunch, In progress")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/[?&]view=list/);
    await expect(listRows(page).first()).toBeVisible();
  });

  test("calendar view: cards on their day and month navigation", async ({ page }) => {
    await switchView(page, "Calendar");
    await expect(page).toHaveURL(/[?&]view=calendar/);
    const title = page.locator("#calendar-title");
    const thisMonth = await title.textContent();

    const target = dayKey(2);
    let cell = page.locator(`td[data-date="${target}"]`);
    if ((await cell.count()) === 0) {
      await page.getByRole("button", { name: "Next month" }).click();
      cell = page.locator(`td[data-date="${target}"]`);
    }
    await expect(cell.getByRole("link", { name: "Responsive navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();

    await page.getByRole("button", { name: "Next month" }).click();
    await expect(title).not.toHaveText(thisMonth!);
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(title).not.toHaveText(thisMonth!);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(title).toHaveText(thisMonth!);

    // Late cards are flagged, not just colored.
    const late = page.locator(`td[data-date="${dayKey(-1)}"]`).getByRole("link", { name: /Contact form spam protection/ });
    if (await late.count()) await expect(late).toContainText("Overdue");

    await page.getByRole("link", { name: "Show in list" }).click();
    await expect(page).toHaveURL(/[?&]view=list/);
    await expect(listRows(page).filter({ hasText: "Pricing page FAQ copy" })).toHaveCount(1);
    await expect(listRows(page).filter({ hasText: "Responsive navigation" })).toHaveCount(0);
  });

  test("save a filter, apply it after a reload and delete it", async ({ page }) => {
    const name = `Navigation work ${Date.now()}`;
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByLabel("Search cards...").fill("navigation");
    await page.getByRole("button", { name: "Save filter" }).click();
    await page.getByLabel("Filter name").fill(name);
    await page.getByLabel("Filter name").press("Enter");
    await expect(toast(page)).toContainText(`Filter "${name}" saved`);

    await page.reload();
    await expect(page.getByRole("link", { name: /Hero section illustrations/ })).toBeVisible();
    await page.getByRole("button", { name: /^Filter/ }).click();
    const saved = page.getByRole("button", { name, exact: true });
    await expect(saved).toHaveAttribute("aria-pressed", "false");
    await saved.click();
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: /Responsive navigation/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Hero section illustrations/ })).toHaveCount(0);

    // Rename: Escape cancels, Enter saves, focus returns to the rename button.
    const renamed = `${name} renamed`;
    await page.getByRole("button", { name: `Rename filter ${name}` }).click();
    await page.getByLabel("Filter name").press("Escape");
    await expect(page.getByRole("button", { name: `Rename filter ${name}` })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByLabel("Filter name").fill(renamed);
    await page.getByLabel("Filter name").press("Enter");
    await expect(toast(page)).toContainText(`Filter renamed to "${renamed}"`);
    await expect(page.getByRole("button", { name: renamed, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Rename filter ${renamed}` })).toBeFocused();

    await page.getByRole("button", { name: `Delete filter ${renamed}` }).click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page)).toContainText("Filter deleted");
    await page.reload();
    await page.getByRole("button", { name: /^Filter/ }).click();
    await expect(page.getByRole("button", { name: renamed, exact: true })).toHaveCount(0);
  });

  test("set a deadline with the d shortcut", async ({ page }) => {
    const target = card(page, "Done", "Sitemap and robots.txt");
    await target.getByRole("link").focus();
    await page.keyboard.press("d");
    const picker = page.getByRole("dialog", { name: /Deadline for Sitemap and robots.txt/ });
    await expect(picker).toBeVisible();
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await picker.getByRole("button", { name: /^Tomorrow/ }).click();
    await expect(picker).toHaveCount(0);
    await expect(target).toContainText("Tomorrow");
    await saved;
    await page.reload();
    await expect(card(page, "Done", "Sitemap and robots.txt")).toContainText("Tomorrow");

    // The card menu opens the same picker; Clear removes the deadline.
    await card(page, "Done", "Sitemap and robots.txt").getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Set deadline" }).click();
    await page.getByRole("dialog", { name: /Deadline for/ }).getByRole("button", { name: "Clear" }).click();
    await expect(card(page, "Done", "Sitemap and robots.txt")).not.toContainText("Tomorrow");
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`views accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("list and calendar views pass axe", async ({ page }) => {
      await loginAs(page, "admin");
      await openDemoBoard(page);
      const report: Record<string, unknown> = {};
      await switchView(page, "List");
      await listRows(page).first().waitFor();
      const list = await axeViolations(page);
      if (list.length) report.list = list;
      await switchView(page, "Calendar");
      await page.locator("#calendar-title").waitFor();
      const calendar = await axeViolations(page);
      if (calendar.length) report.calendar = calendar;
      expect(report, JSON.stringify(report, null, 2)).toEqual({});
    });
  });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("add a card with the bottom bar", async ({ page }) => {
    await loginAs(page, "admin");
    await openDemoBoard(page);
    const title = `Phone card ${Date.now()}`;

    const bar = page.getByRole("button", { name: /^Add card to / });
    await expect(bar).toHaveText("Add card to Backlog");
    await page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: /^To do/ }).click();
    await expect(bar).toHaveText("Add card to To do");
    await bar.click();
    const todo = column(page, "To do");
    await todo.getByPlaceholder("Title").fill(title);
    await todo.getByPlaceholder("Title").press("Enter");
    await expect(card(page, "To do", title)).toBeVisible();

    // The list scrolls inside its own region; the page never scrolls sideways.
    await switchView(page, "List");
    await listRows(page).first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await switchView(page, "Calendar");
    await expect(bar).toHaveCount(0);
    // Only the board content: the app header's phone layout is out of scope here.
    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
