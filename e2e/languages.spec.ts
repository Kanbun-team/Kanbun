import { expect, test, type Page } from "@playwright/test";
import { axeViolations, loginAs } from "./helpers";
import { LOCALE_INFO, LOCALES } from "../src/lib/i18n";

// Translations change text length and accessible names, so every language is
// scanned on the busiest screens, on a desktop and on a phone.
const others = LOCALES.filter((l) => l !== "en");

async function setLanguage(page: Page, name: string) {
  await page.goto("/settings");
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("every language passes axe and fits a phone screen", async ({ page }) => {
  test.setTimeout(240_000);
  await loginAs(page, "piotr");
  const report: Record<string, unknown> = {};
  try {
    for (const locale of others) {
      await setLanguage(page, LOCALE_INFO[locale].name);
      for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        const pages = ["/tasks", "/tasks/me", "/settings", "/whats-new"];
        await page.goto("/tasks");
        const board = await page.getByRole("link", { name: /Website relaunch/ }).first().getAttribute("href");
        if (board) pages.push(board, `${board}?view=list`, `${board}?view=calendar`);
        for (const path of pages) {
          await page.goto(path);
          const key = `${locale} ${size.width} ${path}`;
          const violations = await axeViolations(page);
          if (violations.length) report[key] = violations;
          if (size.width === 390 && !path.startsWith(board ?? "~")) {
            const extra = await overflow(page);
            if (extra > 0) report[`${key} overflow`] = extra;
          }
        }
      }
    }
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setLanguage(page, "English");
  }
  expect(report, JSON.stringify(report, null, 2)).toEqual({});
});
