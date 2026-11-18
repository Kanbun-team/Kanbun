import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard } from "./helpers";

async function openPanel(page: Page, columnName: string, title: string) {
  await card(page, columnName, title).getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  return panel;
}

test("two people on a board see each other, their open card and live moves", async ({ page, browser }) => {
  const other = await browser.newContext();
  const marta = await other.newPage();
  try {
    await loginAs(page, "admin");
    await openDemoBoard(page);
    await loginAs(marta, "marta");
    await openDemoBoard(marta);

    // Board header: each sees the other, never themselves.
    await expect(page.getByRole("img", { name: "Also on this board: Marta Nowak" })).toBeVisible();
    await expect(marta.getByRole("img", { name: "Also on this board: Ada Admin" })).toBeVisible();

    const violations = await axeViolations(page);
    expect(violations).toEqual([]);

    // Same card open in both: the "also viewing" line shows up on each side.
    const title = "Responsive navigation";
    const adaPanel = await openPanel(page, "In progress", title);
    const martaPanel = await openPanel(marta, "In progress", title);
    await expect(adaPanel.getByRole("status").filter({ hasText: "Marta Nowak is also viewing this card" })).toBeVisible();
    await expect(martaPanel.getByRole("status").filter({ hasText: "Ada Admin is also viewing this card" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // Ada closes the panel: Marta's line goes away, and Ada's board shows
    // a small marker on the card Marta still has open.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(martaPanel.getByText("Ada Admin is also viewing this card")).toHaveCount(0);
    await expect(card(page, "In progress", title).getByTestId("card-face-viewers")).toBeVisible();

    // Marta moves a card; on Ada's board it lands in place with a highlight.
    await marta.keyboard.press("Escape");
    await expect(marta.getByRole("dialog")).toHaveCount(0);
    const moved = "Set up preview deployments";
    await card(marta, "Done", moved).getByRole("button", { name: /Actions for/ }).click();
    await marta.getByRole("menuitem", { name: "Move to" }).click();
    const dialog = marta.getByRole("dialog");
    const select = dialog.getByLabel("Column");
    const review = await select.locator("option", { hasText: "Review" }).textContent();
    await select.selectOption({ label: review ?? "" });
    await dialog.getByRole("button", { name: "Move card" }).click();
    await expect(card(marta, "Review", moved)).toBeVisible();

    const live = card(page, "Review", moved);
    await expect(live).toBeVisible();
    await expect(live).toHaveAttribute("data-live-changed", "");
    await expect(column(page, "Done").locator("[data-card-id]").filter({ hasText: moved })).toHaveCount(0);

    // Marta leaves: Ada's header empties.
    await marta.close();
    await expect(page.getByTestId("board-presence")).toHaveCount(0);
  } finally {
    await other.close();
  }
});
