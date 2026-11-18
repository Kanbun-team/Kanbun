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

test("card actions for the open card: move, assign to me, priority", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const title = `Palette card ${Date.now()}`;
  await addCard(page, "To do", title);
  await page.keyboard.press("Escape");
  await card(page, "To do", title).getByRole("link").click();
  await page.waitForURL(/\/cards\//);

  let input = await openPalette(page);
  const section = palette(page).getByRole("group", { name: `Card: ${title}` });
  await expect(section.getByRole("option", { name: "Move to Review" })).toBeVisible();
  await expect(section.getByRole("option", { name: "Move to To do" })).toHaveCount(0);
  await expect(section.getByRole("option", { name: "Open card" })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await section.getByRole("option", { name: "Move to Review" }).click();
  await expect(toast(page)).toContainText(`Moved "${title}" to Review`);
  await expect(palette(page)).toHaveCount(0);

  input = await openPalette(page);
  await input.pressSequentially("assign to me");
  const assign = palette(page).getByRole("option", { name: "Assign to me" });
  await expect(assign).toBeVisible();
  await assign.click();
  await expect(toast(page)).toContainText(`"${title}" is assigned to you`);

  input = await openPalette(page);
  await input.pressSequentially("priority crit");
  await palette(page).getByRole("option", { name: "Set priority: Critical" }).click();
  await expect(toast(page)).toContainText(`Priority of "${title}" set to Critical`);

  // The palette reflects the new state: already assigned, already critical.
  await openPalette(page);
  await expect(palette(page).getByRole("option", { name: "Remove me from assignees" })).toBeVisible();
  await expect(palette(page).getByRole("option", { name: "Set priority: Critical" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  const face = card(page, "Review", title);
  await expect(face).toBeVisible();
  await expect(face).toContainText("Critical");
});

test("right arrow on a card result shows its actions, Escape goes back", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const stamp = Date.now();
  const title = `Arrow card ${stamp}`;
  await addCard(page, "To do", title);
  await page.keyboard.press("Escape");
  await page.goto("/tasks");

  const input = await openPalette(page);
  await input.fill(`arrow card ${stamp}`);
  await expect(palette(page).getByRole("option").first()).toContainText(title);
  await expect(palette(page).getByText("shows the actions of the highlighted card")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  const scoped = palette(page).getByRole("textbox", { name: `Actions for ${title}` });
  await expect(scoped).toBeFocused();
  await expect(palette(page).getByRole("option", { name: "Open card" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Escape returns to the search instead of closing.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeVisible();
  const search = palette(page).getByRole("textbox", { name: "Search boards, cards and comments" });
  await expect(search).toBeFocused();

  await search.fill(`arrow card ${stamp}`);
  await expect(palette(page).getByRole("option").first()).toContainText(title);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(scoped).toBeFocused();
  await scoped.pressSequentially("done");
  await expect(palette(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(toast(page)).toContainText(`Moved "${title}" to Done`);

  await openDemoBoard(page);
  await expect(card(page, "Done", title)).toBeVisible();
});

test("new card on the current board from the palette", async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const input = await openPalette(page);
  await input.pressSequentially("new card");
  await page.keyboard.press("ArrowDown");
  await expect(palette(page).getByRole("option", { name: "New card on Website relaunch" })).toBeVisible();
  await palette(page).getByRole("option", { name: "New card on Website relaunch" }).click();
  const titleInput = palette(page).getByRole("textbox", { name: "Title of the new card" });
  await expect(titleInput).toBeFocused();
  await expect(palette(page).getByText("Enter adds the card to Backlog and opens it.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  const title = `From the palette ${Date.now()}`;
  await titleInput.fill(title);
  await titleInput.press("Enter");
  await expect(page).toHaveURL(/\/cards\//);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page, "Backlog", title)).toBeVisible();
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
