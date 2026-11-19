import { expect, test, type Page } from "@playwright/test";
import { axeViolations, loginAs, openDemoBoard } from "./helpers";

// Board insights (/tasks/<id>/insights) on the demo board, whose seed gives
// every card a history: created two weeks ago at the latest, one column a day.

async function openInsights(page: Page) {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await page.waitForURL(/\/insights$/);
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
}

test.describe("board insights", () => {
  test("shows cycle time, throughput, cumulative flow and aging work, with tables", async ({ page }) => {
    await openInsights(page);
    await expect(page).toHaveTitle(/Insights · Website relaunch/);
    for (const name of ["Cycle time", "Throughput", "Cumulative flow", "Aging work in progress"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // History note and definitions are spelled out.
    await expect(page.getByText(/The card history starts on/)).toBeVisible();
    await expect(page.getByText(/first leaves Backlog until it last enters Done/)).toBeVisible();
    await expect(page.getByTestId("insightsMedian")).toHaveText(/\d+ (day|days|hour|hours)|Under 1 hour/);

    // Every chart has an accessible summary and a table.
    const charts = page.getByRole("img");
    await expect(page.getByRole("img", { name: /^Cycle time distribution: / })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Throughput: / })).toBeVisible();
    await expect(page.getByRole("img", { name: /Cumulative flow over the last 30 days\. Today: Backlog \d+/ })).toBeVisible();
    expect(await charts.count()).toBeGreaterThanOrEqual(3);

    const flow = page.getByRole("region", { name: "Cumulative flow" });
    await flow.getByText("Show as a table").click();
    const flowTable = flow.getByRole("table", { name: "Cumulative flow" });
    await expect(flowTable.getByRole("columnheader", { name: "Done" })).toBeVisible();
    await expect(flowTable.locator("tbody tr")).toHaveCount(30);

    const aging = page.getByRole("region", { name: "Aging work in progress" });
    await expect(aging.getByRole("table", { name: "Aging work in progress" }).locator("tbody tr").first()).toBeVisible();
    await expect(aging.getByRole("table", { name: "Usual time per column" })).toBeVisible();

    // 90 days: the range is a link, the current one marked.
    await flow.getByRole("link", { name: "90 days" }).click();
    await expect(page).toHaveURL(/\?days=90$/);
    await expect(flow.getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("img", { name: /Cumulative flow over the last 90 days/ })).toBeVisible();

    // Back to the board.
    await page.getByRole("link", { name: /Website relaunch/ }).first().click();
    await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  });

  test("cards in their column longer than usual say so on the board", async ({ page }) => {
    await loginAs(page, "admin");
    await openDemoBoard(page);
    // A quiet hourglass, with the reason in the card's accessible name.
    const stale = page.locator("[data-card-id] a", { hasText: /In this column for \d+ days, longer than usual/ });
    await expect(stale.first()).toBeVisible();
    await expect(stale.first().locator("[data-stale]")).toHaveAttribute("title", /longer than usual/);
  });

  test("is reachable from the command palette", async ({ page }) => {
    await loginAs(page, "admin");
    await openDemoBoard(page);
    const palette = page.getByRole("dialog", { name: "Search and commands" });
    // The shortcut listener exists only after hydration: press again until it opens.
    await expect(async () => {
      if (!(await palette.isVisible())) await page.keyboard.press("Control+K");
      await expect(palette).toBeVisible({ timeout: 1000 });
    }).toPass();
    await palette.getByRole("textbox").pressSequentially("insights");
    await palette.getByRole("option", { name: "Insights for Website relaunch" }).click();
    await page.waitForURL(/\/insights$/);
  });

  test("only people who can open the board see its insights", async ({ page }) => {
    // Mobile app: admin and marta only.
    await loginAs(page, "admin");
    await page.goto("/tasks");
    const href = await page.getByRole("link", { name: /Mobile app/ }).first().getAttribute("href");
    expect(href).toMatch(/^\/tasks\/[^/]+$/);
    await page.context().clearCookies();
    await loginAs(page, "tomek");
    await page.goto(`${href}/insights`);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toHaveCount(0);
    await page.goto("/tasks/does-not-exist/insights");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`passes axe (${colorScheme}), on desktop and at 390px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await openInsights(page);
      for (const details of await page.locator("details").all()) await details.locator("summary").click();
      expect(await axeViolations(page)).toEqual([]);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
