import { expect, test, type Locator, type Page } from "@playwright/test";
import { axeViolations, loginAs } from "./helpers";

function tile(page: Page, scope: Page | Locator, name: string) {
  return scope.locator("[data-board-tile]").filter({ has: page.getByRole("link", { name, exact: true }) });
}

test("pin and unpin a board, and the pin survives a reload", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/tasks");
  const pinned = page.getByRole("region", { name: "Pinned" });
  await expect(pinned).toHaveCount(0);

  const operations = page.getByRole("region", { name: "Operations" });
  const pin = tile(page, operations, "Customer support").getByRole("button", { name: "Pin Customer support" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  // Listed once: under Pinned, no longer in its category. Focus follows the tile.
  const pinnedStar = tile(page, pinned, "Customer support").getByRole("button", { name: "Pin Customer support" });
  await expect(pinnedStar).toHaveAttribute("aria-pressed", "true");
  await expect(pinnedStar).toBeFocused();
  await expect(tile(page, operations, "Customer support")).toHaveCount(0);
  await expect(page.locator("[data-board-tile]").filter({ has: page.getByRole("link", { name: "Customer support", exact: true }) })).toHaveCount(1);

  await page.reload();
  await expect(tile(page, pinned, "Customer support")).toBeVisible();
  await expect(tile(page, operations, "Customer support")).toHaveCount(0);
  const unpin = tile(page, pinned, "Customer support").getByRole("button", { name: "Pin Customer support" });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await unpin.focus();
  await page.keyboard.press("Enter");
  await expect(pinned).toHaveCount(0);
  // Back in its category, with the focus on its star.
  const back = tile(page, operations, "Customer support").getByRole("button", { name: "Pin Customer support" });
  await expect(back).toBeFocused();
  await expect(back).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(pinned).toHaveCount(0);
  await expect(
    tile(page, operations, "Customer support").getByRole("button", { name: "Pin Customer support" })
  ).toHaveAttribute("aria-pressed", "false");
});

test("board tiles show open, overdue and member counts", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/tasks");
  const product = page.getByRole("region", { name: "Product" });
  const website = tile(page, product, "Website relaunch");
  await expect(website).toContainText(/\d+ open/);
  // "Contact form spam protection" is due yesterday and not done.
  await expect(website).toContainText("1 overdue");
  await expect(website).toContainText("5 members");
  await expect(website).toContainText(/\d+ of \d+ cards done/);

  const mobile = tile(page, product, "Mobile app");
  await expect(mobile).toContainText("0 open");
  await expect(mobile).not.toContainText("overdue");
});

test("opened boards show up under Recently opened", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/tasks");
  await tile(page, page.getByRole("region", { name: "Operations" }), "Hiring").getByRole("link").click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await page.goto("/tasks");
  const recent = page.getByRole("region", { name: "Recently opened" });
  await expect(recent.getByRole("link").first()).toHaveText("Hiring");
});

test("a board can be dragged into another category", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/tasks");
  const product = page.getByRole("region", { name: "Product" });
  const operations = page.getByRole("region", { name: "Operations" });
  const saved = () => page.waitForResponse((r) => r.request().method() === "POST");

  let done = saved();
  await tile(page, product, "Mobile app").dragTo(tile(page, operations, "Hiring"));
  await done;
  await expect(tile(page, operations, "Mobile app")).toBeVisible();
  await page.reload();
  await expect(tile(page, operations, "Mobile app")).toBeVisible();

  done = saved();
  await tile(page, operations, "Mobile app").dragTo(tile(page, product, "Website relaunch"));
  await done;
  await expect(tile(page, product, "Mobile app")).toBeVisible();
});

test("New board in a category header preselects that category", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New board in Operations" }).click();
  const dialog = page.getByRole("dialog", { name: "New board" });
  await expect(dialog.getByLabel("Category").locator("option:checked")).toHaveText("Operations");

  const name = `Vendor contracts ${Date.now()}`;
  await dialog.getByLabel("Board name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await page.goto("/tasks");
  await expect(tile(page, page.getByRole("region", { name: "Operations" }), name)).toBeVisible();
});

test("My work groups a member's cards by deadline", async ({ page, browser }) => {
  await loginAs(page, "tomek");
  await page.goto("/tasks/me");
  const upcoming = page.getByRole("region", { name: "Upcoming" });
  await expect(upcoming.getByRole("link", { name: /Responsive navigation/ })).toBeVisible();
  await expect(upcoming.getByText("Website relaunch, In progress").first()).toBeVisible();
  await upcoming.getByRole("link", { name: /Responsive navigation/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+\/cards\/[^/]+$/);

  const piotr = await browser.newPage();
  await loginAs(piotr, "piotr");
  await piotr.goto("/tasks/me");
  const overdue = piotr.getByRole("region", { name: "Overdue" });
  await expect(overdue.getByRole("link", { name: /Contact form spam protection/ })).toBeVisible();
  await expect(piotr.getByRole("region", { name: "Later or no deadline" })).toContainText("Newsletter signup");
  await piotr.close();
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`boards home and My work accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("pass axe with pinned and recent boards", async ({ page, browser }) => {
      await loginAs(page, "admin");
      await page.goto("/tasks");
      const operations = page.getByRole("region", { name: "Operations" });
      const pin = tile(page, operations, "Customer support").getByRole("button", { name: "Pin Customer support" });
      await pin.click();
      await expect(page.getByRole("region", { name: "Pinned" })).toBeVisible();
      await tile(page, operations, "Hiring").getByRole("link").click();
      await page.waitForURL(/\/tasks\/[^/]+$/);
      await page.goto("/tasks");
      await expect(page.getByRole("region", { name: "Recently opened" })).toBeVisible();

      const report: Record<string, unknown> = {};
      const home = await axeViolations(page);
      if (home.length) report.home = home;

      await page.goto("/tasks/me");
      const mine = await axeViolations(page);
      if (mine.length) report.myWorkAdmin = mine;

      const context = await browser.newContext({ colorScheme });
      const tomek = await context.newPage();
      await loginAs(tomek, "tomek");
      await tomek.goto("/tasks/me");
      const tomekWork = await axeViolations(tomek);
      if (tomekWork.length) report.myWorkTomek = tomekWork;
      await context.close();

      await page.goto("/tasks");
      await tile(page, page.getByRole("region", { name: "Pinned" }), "Customer support")
        .getByRole("button", { name: "Pin Customer support" })
        .click();
      await expect(page.getByRole("region", { name: "Pinned" })).toHaveCount(0);

      expect(report, JSON.stringify(report, null, 2)).toEqual({});
    });
  });
}
