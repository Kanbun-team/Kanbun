import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

// A guard against performance regressions on a 500-card board
// (scripts/seed-large.ts, numbers in docs/PERFORMANCE.md). It seeds the board
// into the e2e database, so it only runs with E2E_PERF=1:
//
//   E2E_PERF=1 npx playwright test e2e/perf.spec.ts
//
// The budgets are about 3 times the targets in docs/ROADMAP.md (first load
// under 1.5s, interactions under 100ms) so that slow CI machines do not flake;
// a real regression (for example every card re-rendering on a drag, or a
// filter that recreates every card) is slower than that. Times are taken
// around Playwright calls, so they include a few milliseconds of round trips.
const LOAD_BUDGET_MS = 5000;
const INTERACTION_BUDGET_MS = 300;
const BOARD = "Large board (performance)";

test.skip(process.env.E2E_PERF !== "1", "set E2E_PERF=1 to run the 500-card performance guard");

function seedLarge(...args: string[]) {
  // Same database as scripts/e2e-serve.sh.
  const DATABASE_URL = process.env.E2E_POSTGRES_URL || "file:./e2e.db";
  execFileSync("npx", ["tsx", "scripts/seed-large.ts", ...args], {
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
}

test.describe("500-card board", () => {
  test.describe.configure({ timeout: 120_000 });
  test.beforeAll(() => seedLarge());
  test.afterAll(() => seedLarge("--remove"));

  test("loads and moves a card with the keyboard within budget", async ({ page }) => {
    await loginAs(page, "admin");
    const boardLink = page.getByRole("link", { name: new RegExp(BOARD.replace(/[()]/g, "\\$&")) }).first();
    const href = await boardLink.getAttribute("href");
    expect(href).toBeTruthy();

    // First load: navigation start until the board is hydrated (a card can
    // be picked up), measured in the page.
    await page.goto(href!);
    // Cards hidden by a filter stay in the page.
    const cards = page.locator("[data-column-id] [data-card-id]:not([hidden])");
    await expect(cards).toHaveCount(500);
    const first = page.getByRole("region", { name: "Backlog", exact: true }).locator("[data-card-id] a").first();
    await first.focus();
    const live = page.locator("[id^=DndLiveRegion]");
    await page.keyboard.press("Space");
    await expect(live).toContainText("is in Backlog");
    const loadMs = await page.evaluate(() => performance.now());
    await page.keyboard.press("Escape");
    await expect(live).toContainText("Move cancelled");
    console.log(`500-card board hydrated after ${Math.round(loadMs)}ms (budget ${LOAD_BUDGET_MS}ms)`);
    expect(loadMs).toBeLessThan(LOAD_BUDGET_MS);

    // Keyboard move: each key press until the live region announces it.
    const timed = async (key: string, text: string) => {
      const t0 = await page.evaluate(() => performance.now());
      await page.keyboard.press(key);
      await expect(live).toContainText(text);
      return (await page.evaluate(() => performance.now())) - t0;
    };
    await first.focus();
    const pickUp = await timed("Space", "is in Backlog");
    const title = ((await live.textContent()) ?? "").split(" is in ")[0];
    const move = await timed("ArrowRight", `${title} is in To do`);
    const saved = page.waitForResponse((r) => r.request().method() === "POST");
    const drop = await timed("Space", `Moved ${title} to To do`);
    await saved;
    console.log(`keyboard pick up ${Math.round(pickUp)}ms, move ${Math.round(move)}ms, drop ${Math.round(drop)}ms`);
    for (const ms of [pickUp, move, drop]) expect(ms).toBeLessThan(INTERACTION_BUDGET_MS);
    await expect(page.getByRole("region", { name: "To do", exact: true }).getByRole("link", { name: title })).toBeVisible();

    // Pointer drag start: press, move past the 6px activation distance, until
    // the drag is announced, timed in the page (from the move that starts the
    // drag to the announcement). Escape cancels it.
    const box = (await cards.nth(3).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      const w = window as unknown as { __drag: { move?: number; announced?: number } };
      w.__drag = {};
      window.addEventListener("mousemove", () => (w.__drag.move ??= performance.now()), { capture: true, once: true });
      const region = document.querySelector("[id^=DndLiveRegion]")!;
      new MutationObserver((_, observer) => {
        w.__drag.announced = performance.now();
        observer.disconnect();
      }).observe(region, { childList: true, characterData: true, subtree: true });
    });
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12);
    await expect(live).toContainText("is in");
    const dragStart = await page.evaluate(() => {
      const d = (window as unknown as { __drag: { move: number; announced: number } }).__drag;
      return d.announced - d.move;
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(live).toContainText("Move cancelled");
    console.log(`pointer drag start ${Math.round(dragStart)}ms`);
    expect(dragStart).toBeLessThan(INTERACTION_BUDGET_MS);

    // Typing in the filter narrows 500 cards on every key press.
    await page.locator("body").press("/");
    const search = page.getByRole("searchbox");
    const t0 = await page.evaluate(() => performance.now());
    await search.pressSequentially("#499");
    await expect(cards).toHaveCount(1);
    const filterMs = (await page.evaluate(() => performance.now())) - t0;
    console.log(`filter typed and applied in ${Math.round(filterMs)}ms`);
    expect(filterMs).toBeLessThan(INTERACTION_BUDGET_MS * 3);

    // Clearing the filter brings 499 cards back.
    const c0 = await page.evaluate(() => performance.now());
    await search.fill("");
    await expect(cards).toHaveCount(500);
    const clearMs = (await page.evaluate(() => performance.now())) - c0;
    console.log(`filter cleared in ${Math.round(clearMs)}ms`);
    expect(clearMs).toBeLessThan(INTERACTION_BUDGET_MS);
  });
});
