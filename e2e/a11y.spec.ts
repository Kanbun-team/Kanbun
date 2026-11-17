import { expect, test } from "@playwright/test";
import { axeViolations, column, loginAs, openDemoBoard } from "./helpers";

// Every page is scanned in both themes; violations are collected per page so a
// failure lists everything at once instead of stopping at the first page.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("all pages pass axe (WCAG 2.2 AA)", async ({ page }) => {
      const report: Record<string, unknown> = {};
      const scan = async (name: string) => {
        const violations = await axeViolations(page);
        if (violations.length) report[name] = violations;
      };

      await page.goto("/login");
      await scan("login");

      await loginAs(page, "admin");
      await scan("boards");

      await openDemoBoard(page);
      await scan("board");
      const boardUrl = page.url();

      await column(page, "In progress").getByRole("link", { name: "Responsive navigation" }).click();
      await page.waitForURL(/\/cards\//);
      await scan("card");

      for (const path of [`${boardUrl}/settings`, "/tasks/me", "/settings", "/admin/users", "/trash", "/whats-new", "/users/marta"]) {
        await page.goto(path);
        await scan(path.replace(boardUrl, "board"));
      }

      expect(report, JSON.stringify(report, null, 2)).toEqual({});
    });
  });
}
