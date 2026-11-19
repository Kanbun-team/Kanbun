import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, drag, loginAs, toast } from "./helpers";

// Board automations: a rule made in board settings runs when a card enters
// its column, by drag or by keyboard, and its changes can be undone from the
// toast and from the card history. Uses the "Customer support" demo board
// (To do, Doing, Done; no tags) so the other specs' boards stay as they are.

async function openSupportBoard(page: Page) {
  await page.goto("/tasks");
  await page.getByRole("link", { name: /Customer support/ }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await expect(column(page, "Doing")).toBeVisible();
  return page.url();
}

async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName);
  await col.getByRole("button", { name: "Add card" }).click();
  await col.getByPlaceholder("Title").fill(title);
  await col.getByPlaceholder("Title").press("Enter");
  await expect(card(page, columnName, title)).toBeVisible();
  await page.keyboard.press("Escape");
}

test("a rule runs on a drag and on a keyboard move, and its changes can be undone", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAs(page, "admin");
  const boardUrl = await openSupportBoard(page);
  await page.goto(`${boardUrl}/settings`);

  // A tag for the rule to add.
  const tagForm = page.locator("form").filter({ has: page.getByLabel("Tag name") });
  await tagForm.getByLabel("Tag name").fill("Blocked");
  await tagForm.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();

  const section = page.getByRole("region", { name: "Automations" });
  await expect(section.getByText("No rules yet.", { exact: false })).toBeVisible();
  await section.getByRole("button", { name: "Add rule" }).click();
  const dialog = page.getByRole("dialog", { name: "Add rule" });
  await dialog.getByLabel("Name", { exact: true }).fill("Done cleanup");
  await expect(dialog.getByRole("radio", { name: "A card enters a column" })).toBeChecked();
  await dialog.getByRole("combobox", { name: "Column", exact: true }).selectOption({ label: "Done" });
  await dialog.getByRole("combobox", { name: "Action 1" }).selectOption({ label: "Set the priority" });
  await dialog.getByRole("combobox", { name: "Priority", exact: true }).selectOption({ label: "High" });
  await dialog.getByRole("button", { name: "Add action" }).click();
  await dialog.getByRole("combobox", { name: "Action 2" }).selectOption({ label: "Add a tag" });
  await dialog.getByRole("combobox", { name: "Tag", exact: true }).selectOption({ label: "Blocked" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(toast(page)).toContainText("Rule added");
  await expect(section.getByText("When a card enters Done: set priority to High, add tag Blocked")).toBeVisible();
  await expect(section.getByRole("switch", { name: "On" })).toBeChecked();

  // Drag: the rule runs and the toast offers Undo.
  await page.goto(boardUrl);
  const stamp = Date.now();
  const dragged = `Refund request ${stamp}`;
  await addCard(page, "To do", dragged);
  await drag(page, card(page, "To do", dragged), column(page, "Done"));
  await expect(toast(page)).toContainText("Rule “Done cleanup” updated the card");
  await expect(card(page, "Done", dragged)).toContainText("Blocked");
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(toast(page)).toContainText("Rule changes undone");
  await expect(card(page, "Done", dragged)).not.toContainText("Blocked");
  // Undo reverts the rule, not the move.
  await page.reload();
  await expect(card(page, "Done", dragged)).toBeVisible();
  await expect(card(page, "Done", dragged)).not.toContainText("Blocked");

  // Keyboard: Space, Right, Space.
  const moved = `Login issue ${stamp}`;
  await addCard(page, "Doing", moved);
  await card(page, "Doing", moved).getByRole("link").focus();
  const live = page.locator("[id^=DndLiveRegion]");
  await page.keyboard.press("Space");
  await expect(live).toContainText(`${moved} is in Doing`);
  await page.keyboard.press("ArrowRight");
  await expect(live).toContainText("is in Done");
  await page.keyboard.press("Space");
  await expect(toast(page)).toContainText("Rule “Done cleanup” updated the card");
  await expect(card(page, "Done", moved)).toContainText("Blocked");

  // The history names the rule, and has its own Undo.
  await card(page, "Done", moved).getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  const panel = page.getByRole("dialog", { name: "Open card" });
  await expect(panel.getByText("Rule “Done cleanup” changed the priority from Normal to High")).toBeVisible();
  await expect(panel.getByText("Rule “Done cleanup” added the tag Blocked")).toBeVisible();
  await panel.getByRole("button", { name: "Undo the changes of the rule “Done cleanup”" }).click();
  await expect(toast(page)).toContainText("Rule changes undone");
  await expect(panel.getByText("Ada Admin undid the changes of the rule “Done cleanup”")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Undo the changes of the rule “Done cleanup”" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card(page, "Done", moved)).not.toContainText("Blocked");

  // With swimlanes, a keyboard move into Done runs the rule and offers Undo too.
  await page.goto(boardUrl);
  const laned = `Invoice copy ${stamp}`;
  await addCard(page, "Doing", laned);
  await page.goto(`${boardUrl}?group=priority`);
  await page.getByRole("link", { name: new RegExp(laned) }).first().focus();
  await page.keyboard.press("Space");
  await expect(live).toContainText(`${laned} is in Doing`);
  await page.keyboard.press("ArrowRight");
  await expect(live).toContainText("is in Done");
  await page.keyboard.press("Space");
  await expect(toast(page)).toContainText("Rule “Done cleanup” updated the card");
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(toast(page)).toContainText("Rule changes undone");

  // Switched off, it no longer runs; then delete it.
  await page.goto(`${boardUrl}/settings`);
  await section.getByText("On", { exact: true }).click();
  await expect(section.getByRole("switch", { name: "On" })).not.toBeChecked();
  await page.goto(boardUrl);
  const quiet = `Feature question ${stamp}`;
  await addCard(page, "Doing", quiet);
  await drag(page, card(page, "Doing", quiet), column(page, "Done"));
  // Drops are silent without rules; check what the server saved.
  await expect(async () => {
    await page.reload();
    await expect(card(page, "Done", quiet)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(card(page, "Done", quiet)).not.toContainText("Blocked");

  await page.goto(`${boardUrl}/settings`);
  await section.getByRole("button", { name: "Edit Done cleanup" }).waitFor();
  await section.getByRole("button", { name: "Delete Done cleanup" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(toast(page)).toContainText("Rule deleted");
  await expect(section.getByText("No rules yet.", { exact: false })).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`automation settings (${colorScheme}, 390px)`, () => {
    test.use({ colorScheme, viewport: { width: 390, height: 844 } });

    test("pass axe and fit the phone width", async ({ page }) => {
      await loginAs(page, "admin");
      const boardUrl = await openSupportBoard(page);
      await page.goto(`${boardUrl}/settings`);
      const section = page.getByRole("region", { name: "Automations" });
      await section.getByRole("button", { name: "Add rule" }).click();
      const dialog = page.getByRole("dialog", { name: "Add rule" });
      await dialog.getByLabel("Name", { exact: true }).fill(`Overdue ${colorScheme}`);
      await dialog.getByText("A card's deadline passes").click();
      await expect(dialog.getByRole("radio", { name: "A card's deadline passes" })).toBeChecked();
      await expect(dialog.getByText("Checked every few minutes.", { exact: false })).toBeVisible();
      await dialog.getByRole("combobox", { name: "Action 1" }).selectOption({ label: "Move to a column" });
      await dialog.getByRole("combobox", { name: "Column", exact: true }).selectOption({ label: "Doing" });

      const open = await axeViolations(page);
      expect(open, JSON.stringify(open, null, 2)).toEqual([]);
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox!.width).toBeLessThanOrEqual(390);

      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(toast(page)).toContainText("Rule added");
      await expect(section.getByText("When a card's deadline passes: move to Doing")).toBeVisible();
      const closed = await axeViolations(page);
      expect(closed, JSON.stringify(closed, null, 2)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      await section.getByRole("button", { name: `Delete Overdue ${colorScheme}` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await expect(toast(page)).toContainText("Rule deleted");
    });
  });
}
