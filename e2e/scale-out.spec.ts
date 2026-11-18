import { expect, test } from "@playwright/test";
import { card, column, loginAs, openDemoBoard, toast } from "./helpers";

// Two Kanbun instances on one PostgreSQL database and one Redis (docs/SCALING.md).
// Runs only when E2E_SECOND_ORIGIN points at the second instance, as in the
// PostgreSQL CI job: Ada uses the default server, Marta the second one.
const second = process.env.E2E_SECOND_ORIGIN;

test.describe("several instances", () => {
  test.skip(!second, "set E2E_SECOND_ORIGIN to a second instance sharing the database and Redis");

  test("presence, open cards and live changes cross instances", async ({ page, browser }) => {
    const other = await browser.newContext({ baseURL: second });
    const marta = await other.newPage();
    try {
      await loginAs(page, "admin");
      await openDemoBoard(page);
      await loginAs(marta, "marta");
      await openDemoBoard(marta);
      expect(new URL(marta.url()).origin).toBe(new URL(second!).origin);

      // Presence lives in Redis: each sees the other although their streams
      // are on different instances.
      await expect(page.getByRole("img", { name: "Also on this board: Marta Nowak" })).toBeVisible();
      await expect(marta.getByRole("img", { name: "Also on this board: Ada Admin" })).toBeVisible();

      // The open card is reported to Marta's instance and shows on Ada's.
      const open = "Responsive navigation";
      await card(marta, "In progress", open).getByRole("link").click();
      await marta.waitForURL(/\/cards\//);
      await expect(card(page, "In progress", open).getByTestId("card-face-viewers")).toBeVisible();
      await marta.keyboard.press("Escape");
      await expect(card(page, "In progress", open).getByTestId("card-face-viewers")).toHaveCount(0);

      // A card added on instance B appears live on instance A.
      const title = `Scale-out card ${Date.now()}`;
      const todo = column(marta, "To do");
      await todo.getByRole("button", { name: "Add card" }).click();
      await todo.getByPlaceholder("Title").fill(title);
      await todo.getByPlaceholder("Title").press("Enter");
      await expect(card(marta, "To do", title)).toBeVisible();
      await expect(card(page, "To do", title)).toBeVisible();

      // And a delete on A disappears live on B.
      await card(page, "To do", title).getByRole("link").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete card" }).click();
      await expect(toast(page)).toContainText("Card deleted");
      await expect(card(marta, "To do", title)).toHaveCount(0);

      // Marta leaves: Ada's header empties.
      await marta.close();
      await expect(page.getByTestId("board-presence")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});
