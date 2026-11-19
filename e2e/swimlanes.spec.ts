import { expect, test, type Page } from "@playwright/test";
import { axeViolations, drag, loginAs, openDemoBoard } from "./helpers";

// A column's part of a lane.
const cell = (page: Page, column: string, lane: string) => page.getByRole("group", { name: `${column}, ${lane}`, exact: true });
const cellCard = (page: Page, column: string, lane: string, title: string) =>
  cell(page, column, lane).locator("[data-card-id]").filter({ hasText: title });
const lane = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

async function groupBy(page: Page, option: "No lanes" | "Assignee" | "Priority" | "Tag") {
  await page.getByRole("button", { name: /^Lanes/ }).click();
  await page.getByRole("menuitemradio", { name: option }).click();
}

/** Adds a card through a cell's own "Add card", which also puts it in that lane. */
async function addToCell(page: Page, column: string, laneName: string, title: string) {
  const target = cell(page, column, laneName);
  await target.getByRole("button", { name: "Add card" }).click();
  await target.getByPlaceholder("Title").fill(title);
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await target.getByPlaceholder("Title").press("Enter");
  await saved;
  await expect(cellCard(page, column, laneName, title)).toBeVisible();
  await target.getByPlaceholder("Title").press("Escape");
}

test.describe("swimlanes", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await openDemoBoard(page);
  });

  test("group by priority, collapse a lane, keep it in the URL", async ({ page }) => {
    await groupBy(page, "Priority");
    await expect(page).toHaveURL(/[?&]group=priority/);
    await expect(page.getByRole("button", { name: "Lanes: Priority" })).toBeVisible();
    for (const name of ["Critical", "High", "Normal", "Low"]) await expect(lane(page, name)).toBeVisible();
    await expect(cellCard(page, "In progress", "Critical", "Contact form spam protection")).toBeVisible();
    // The WIP count covers the whole column, across lanes.
    await expect(page.locator('[data-lane-column]').filter({ hasText: "In progress" })).toContainText("/3");

    const toggle = lane(page, "Low").getByRole("button", { name: /^Low/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(cell(page, "Backlog", "Low")).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(/[?&]group=priority/);
    await expect(lane(page, "Low").getByRole("button", { name: /^Low/ })).toHaveAttribute("aria-expanded", "false");
    await lane(page, "Low").getByRole("button", { name: /^Low/ }).click();
    await expect(cell(page, "Backlog", "Low")).toBeVisible();

    // The lanes stay under the card panel, and come back in the URL after it.
    await cellCard(page, "In progress", "Critical", "Contact form spam protection").getByRole("link").click();
    await expect(page).toHaveURL(/\/cards\//);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("[data-swimlanes]")).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/[?&]group=priority/);
    await expect(cellCard(page, "In progress", "Critical", "Contact form spam protection")).toBeVisible();

    // Filters still work: non-matching cards are hidden in every lane.
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByLabel("Search cards...").fill("spam protection");
    await expect(cellCard(page, "In progress", "Critical", "Contact form spam protection")).toBeVisible();
    await expect(cellCard(page, "In progress", "High", "Responsive navigation")).toBeHidden();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(cellCard(page, "In progress", "High", "Responsive navigation")).toBeVisible();
    await page.getByRole("button", { name: /^Filter/ }).click();

    await groupBy(page, "No lanes");
    await expect(page).not.toHaveURL(/group=/);
    await expect(page.getByRole("region", { name: "In progress" })).toBeVisible();
  });

  test("a card with two assignees is moved from its first lane and shown as a copy in the other", async ({ page }) => {
    await groupBy(page, "Assignee");
    await expect(lane(page, "No assignee")).toBeVisible();
    // Julia comes before Marta in lane order.
    await expect(cellCard(page, "Done", "Julia Kowalczyk", "Kickoff workshop notes")).toBeVisible();
    const copy = cell(page, "Done", "Marta Nowak").getByRole("link", { name: /Kickoff workshop notes/ });
    await expect(copy).toBeVisible();
    await expect(copy).toContainText("Copy. Move the card in the Julia Kowalczyk lane.");
    await expect(cellCard(page, "Done", "Marta Nowak", "Kickoff workshop notes")).toHaveCount(0);
  });

  test("drag a card to another lane and column with the mouse", async ({ page }) => {
    await page.goto(`${page.url()}?group=assignee`);
    const title = `Lane drag ${Date.now()}`;
    await addToCell(page, "To do", "Marta Nowak", title);

    // Both ends well inside the window, so the drag does not scroll it.
    await cell(page, "Review", "Piotr Zieliński").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await drag(page, cellCard(page, "To do", "Marta Nowak", title), cell(page, "Review", "Piotr Zieliński"));
    await expect(cellCard(page, "Review", "Piotr Zieliński", title)).toBeVisible();
    await saved;
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(cellCard(page, "Review", "Piotr Zieliński", title)).toBeVisible();
    await expect(cellCard(page, "To do", "Marta Nowak", title)).toHaveCount(0);

    // Marta was replaced by Piotr, so there is no copy in her lane either.
    await expect(cell(page, "Review", "Marta Nowak").getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
  });

  test("move a card across lanes and columns with the keyboard", async ({ page }) => {
    await page.goto(`${page.url()}?group=priority`);
    const title = `Lane keys ${Date.now()}`;
    await addToCell(page, "Backlog", "Normal", title);

    await cellCard(page, "Backlog", "Normal", title).getByRole("link").focus();
    const live = page.locator("[id^=DndLiveRegion]");
    await page.keyboard.press("Space");
    await expect(live).toContainText(`${title} is in Backlog, lane Normal`);
    await page.keyboard.press("ArrowRight");
    await expect(live).toContainText(`${title} is in To do, lane Normal`);
    await page.keyboard.press("Shift+ArrowUp");
    await expect(live).toContainText(`${title} is in To do, lane High`);
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    await page.keyboard.press("Space");
    await expect(live).toContainText(`Moved ${title} to To do, lane High`);
    await saved;
    await expect(cellCard(page, "To do", "High", title)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(cellCard(page, "To do", "High", title)).toBeVisible();

    // j/k continue into the next lane of the same column.
    await cellCard(page, "To do", "High", title).getByRole("link").focus();
    const high = await cell(page, "To do", "High").locator("[data-card-id]").count();
    for (let i = 0; i < high; i++) await page.keyboard.press("j");
    await expect(page.locator(":focus")).toHaveCount(1);
    const focusedCell = await page.evaluate(() => document.activeElement?.closest("[data-cell]")?.getAttribute("aria-label"));
    expect(focusedCell).toBe("To do, Normal");
  });

  test("a move to another lane made offline is queued and synced", async ({ page, context }) => {
    await page.goto(`${page.url()}?group=priority`);
    const title = `Lane offline ${Date.now()}`;
    await addToCell(page, "Backlog", "Normal", title);
    await context.setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();

    await cellCard(page, "Backlog", "Normal", title).getByRole("link").focus();
    const live = page.locator("[id^=DndLiveRegion]");
    await page.keyboard.press("Space");
    await expect(live).toContainText(`${title} is in Backlog, lane Normal`);
    await page.keyboard.press("Shift+ArrowDown");
    await expect(live).toContainText(`${title} is in Backlog, lane Low`);
    await page.keyboard.press("ArrowRight");
    await expect(live).toContainText(`${title} is in To do, lane Low`);
    await page.keyboard.press("Space");
    await expect(cellCard(page, "To do", "Low", title)).toBeVisible();
    await expect(page.getByTestId("offline-pending")).toHaveText("2 changes waiting to sync");

    await context.setOffline(false);
    await expect(page.getByTestId("offline-pending")).toHaveCount(0);
    await page.reload();
    await expect(cellCard(page, "To do", "Low", title)).toBeVisible();
  });

  test("a teammate's change moves the card to its new lane live", async ({ page, browser }) => {
    const boardUrl = page.url();
    await page.goto(`${boardUrl}?group=priority`);
    const title = `Lane live ${Date.now()}`;
    await addToCell(page, "Backlog", "Normal", title);

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await other.newPage();
    await loginAs(page2, "marta");
    await page2.goto(boardUrl);
    const face = page2.getByRole("region", { name: "Backlog", exact: true }).locator("[data-card-id]").filter({ hasText: title });
    await face.getByRole("button", { name: /Actions for/ }).click();
    await page2.getByRole("menuitem", { name: "Priority" }).click();
    const saved = page2.waitForResponse((r) => r.request().method() === "POST");
    await page2.getByRole("menuitem", { name: "Critical" }).click();
    await saved;
    await other.close();

    await expect(cellCard(page, "Backlog", "Critical", title)).toBeVisible();
    await expect(cellCard(page, "Backlog", "Normal", title)).toHaveCount(0);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`passes axe with lanes (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      for (const group of ["assignee", "tag"]) {
        await page.goto(`${page.url().split("?")[0]}?group=${group}`);
        await expect(page.locator("[data-swimlanes]")).toBeVisible();
        expect(await axeViolations(page)).toEqual([]);
      }
    });
  }
});

test.describe("swimlanes on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("one column per screen, lanes stacked", async ({ page }) => {
    await loginAs(page, "admin");
    await openDemoBoard(page);
    await page.goto(`${page.url()}?group=priority`);
    await expect(lane(page, "Critical")).toBeVisible();
    const header = page.locator("[data-lane-column]").first();
    const box = (await header.boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    expect(box.width).toBeLessThan(390);
    // Lanes are below each other, and the page itself does not scroll sideways.
    const critical = (await lane(page, "Critical").boundingBox())!;
    const high = (await lane(page, "High").boundingBox())!;
    expect(high.y).toBeGreaterThan(critical.y + critical.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // The lane name stays in view when the board scrolls to another column.
    await page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: /^Review/ }).click();
    await expect(cell(page, "Review", "High")).toBeInViewport();
    await expect(lane(page, "High").getByRole("button", { name: /^High/ })).toBeInViewport();
    expect(await axeViolations(page)).toEqual([]);
  });
});
