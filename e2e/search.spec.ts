import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Search and commands" });
}

async function openPalette(page: Page, key = "Control+K") {
  await page.keyboard.press(key);
  await expect(palette(page)).toBeVisible();
  const input = palette(page).getByRole("textbox", { name: "Search boards, cards and comments" });
  await expect(input).toBeFocused();
  return input;
}

async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName);
  await col.getByRole("button", { name: "Add card" }).click();
  await col.getByPlaceholder("Title").fill(title);
  await col.getByPlaceholder("Title").press("Enter");
  await expect(card(page, columnName, title)).toBeVisible();
}

test("Ctrl+K and Meta+K open the palette; Enter opens the top card", async ({ page }) => {
  await loginAs(page, "admin");

  await openPalette(page, "Meta+K");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);

  const input = await openPalette(page);
  await input.fill("navigation");
  const option = palette(page).getByRole("option", { name: /Responsive navigation/ });
  await expect(option).toBeVisible();
  await expect(palette(page).getByRole("option").first()).toContainText("Responsive navigation");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tasks\/[^/]+\/cards\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Responsive navigation" }).first()).toBeVisible();
});

test("the nav button opens the palette and arrows pick an action", async ({ page }) => {
  await loginAs(page, "admin");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const input = palette(page).getByRole("textbox");
  await expect(input).toBeFocused();
  await expect(palette(page).getByText("Type a word from a board name")).toBeVisible();
  await input.pressSequentially("trash");
  const action = palette(page).getByRole("option", { name: "Open Trash" });
  await expect(action).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveAttribute("aria-activedescendant", (await action.getAttribute("id"))!);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/trash$/);
});

test("comments are searched and the match is highlighted", async ({ page }) => {
  await loginAs(page, "admin");
  const input = await openPalette(page);
  await input.fill("figma");
  const option = palette(page).getByRole("option", { name: /Responsive navigation/ });
  await expect(option).toBeVisible();
  await expect(option.locator("mark")).toHaveText("Figma");
});

test("matches Polish words typed without diacritics", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const stamp = Date.now();
  const title = `Wdrożenie źródeł ${stamp}`;
  await addCard(page, "To do", title);

  const input = await openPalette(page);
  await input.fill(`wdrozenie zrodel ${stamp}`);
  await expect(palette(page).getByRole("option", { name: new RegExp(title) })).toBeVisible();
});

test("no results, and a board name match", async ({ page }) => {
  await loginAs(page, "admin");
  const input = await openPalette(page);
  await input.fill("qqqxyzzy");
  await expect(palette(page).getByText('Nothing matches "qqqxyzzy"')).toBeVisible();
  await input.fill("mobile");
  await palette(page).getByRole("option", { name: "Mobile app" }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  await expect(page.getByRole("region", { name: "To do" })).toBeVisible();
});

test("search follows trash: deleted cards disappear and come back on undo", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const stamp = Date.now();
  const title = `Trash search ${stamp}`;
  await addCard(page, "Backlog", title);
  await card(page, "Backlog", title).getByRole("link").click();
  await page.getByLabel("Write a comment").fill(`Remember the zebracrossing${stamp}`);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText(`zebracrossing${stamp}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);

  let input = await openPalette(page);
  await input.fill(`zebracrossing${stamp}`);
  await expect(palette(page).getByRole("option", { name: new RegExp(title) })).toBeVisible();
  await page.keyboard.press("Escape");

  await card(page, "Backlog", title).getByRole("link").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await expect(toast(page)).toContainText("Card deleted");

  input = await openPalette(page);
  await input.fill(`zebracrossing${stamp}`);
  await expect(palette(page).getByText("Nothing matches")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "Backlog", title)).toBeVisible();
  input = await openPalette(page);
  await input.fill(`zebracrossing${stamp}`);
  await expect(palette(page).getByRole("option", { name: new RegExp(title) })).toBeVisible();
});

test("members only find cards on their own boards", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await page.getByRole("link", { name: /Mobile app/ }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  const stamp = Date.now();
  const title = `Private roadmap ${stamp}`;
  await addCard(page, "To do", title);

  let input = await openPalette(page);
  await input.fill(`roadmap ${stamp}`);
  await expect(palette(page).getByRole("option", { name: new RegExp(title) })).toBeVisible();

  const julia = await browser.newPage();
  await loginAs(julia, "julia");
  input = await openPalette(julia);
  await input.fill(`roadmap ${stamp}`);
  await expect(palette(julia).getByText("Nothing matches")).toBeVisible();
  await expect(palette(julia).getByRole("option", { name: new RegExp(title) })).toHaveCount(0);
  await input.fill("mobile");
  await expect(palette(julia).getByText("Nothing matches")).toBeVisible();
  // Julia is a member of Website relaunch, so its cards are found.
  await input.fill("navigation");
  await expect(palette(julia).getByRole("option", { name: /Responsive navigation/ })).toBeVisible();
  await julia.close();
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`palette accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("open palette passes axe", async ({ page }) => {
      await loginAs(page, "admin");
      await openPalette(page);
      expect(await axeViolations(page)).toEqual([]);
      await palette(page).getByRole("textbox").fill("figma");
      await expect(palette(page).getByRole("option", { name: /Responsive navigation/ })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  });
}
