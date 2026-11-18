// Measures the large board (scripts/seed-large.ts) on a running production
// server, see docs/PERFORMANCE.md. Prints a JSON report.
//
//   PERF_URL=http://localhost:3550 PERF_CPU=4 npx tsx scripts/perf-board.ts
//
// PERF_CPU slows the browser's CPU down by that factor (Chrome DevTools
// throttling), to approximate a slower laptop. Interaction numbers come from
// the Event Timing API (input delay + handlers + next paint, like INP) and
// from long tasks; page loads from Navigation Timing.
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.PERF_URL ?? "http://localhost:3550";
const CPU = Number(process.env.PERF_CPU ?? 1);
const USER = process.env.PERF_USER ?? "admin";
const PASSWORD = process.env.PERF_PASSWORD ?? "demo1234";
const BOARD = process.env.PERF_BOARD ?? "Large board (performance)";
const RUNS = Number(process.env.PERF_RUNS ?? 5);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.floor(s.length / 2)]) : NaN;
};

// Collects Event Timing entries and long tasks in the page.
const OBSERVER = () => {
  const w = window as unknown as { __perf: { events: PerformanceEventTiming[]; long: PerformanceEntry[] } };
  w.__perf = { events: [], long: [] };
  new PerformanceObserver((list) => w.__perf.events.push(...(list.getEntries() as PerformanceEventTiming[]))).observe({
    type: "event",
    buffered: true,
    durationThreshold: 16,
  } as PerformanceObserverInit);
  new PerformanceObserver((list) => w.__perf.long.push(...list.getEntries())).observe({ type: "longtask", buffered: true });
};

/** Runs `action` and returns the slowest input event and long task time it caused. */
async function measure(page: Page, action: () => Promise<void>, settle = 300) {
  const start = await page.evaluate(() => performance.now());
  const t0 = Date.now();
  await action();
  const wall = Date.now() - t0;
  await page.waitForTimeout(settle);
  return page.evaluate(
    ({ start, wall }) => {
      const w = window as unknown as { __perf: { events: PerformanceEventTiming[]; long: PerformanceEntry[] } };
      const events = w.__perf.events.filter((e) => e.startTime >= start);
      const long = w.__perf.long.filter((e) => e.startTime >= start);
      return {
        event: Math.round(Math.max(0, ...events.map((e) => e.duration))),
        eventName: events.sort((a, b) => b.duration - a.duration)[0]?.name ?? null,
        longTasks: long.length,
        longTaskMs: Math.round(long.reduce((s, e) => s + e.duration, 0)),
        maxLongTask: Math.round(Math.max(0, ...long.map((e) => e.duration))),
        wall,
      };
    },
    { start, wall }
  );
}

async function loadMetrics(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const w = window as unknown as { __perf: { long: PerformanceEntry[] } };
    const long = w.__perf.long;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      ttfb: Math.round(nav.responseStart),
      html: Math.round(nav.responseEnd),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      longTasks: long.length,
      longTaskMs: Math.round(long.reduce((s, e) => s + e.duration, 0)),
      // Main thread busy until here: a rough "interactive" time.
      lastLongTaskEnd: Math.round(Math.max(0, ...long.map((e) => e.startTime + e.duration))),
      htmlBytes: nav.transferSize,
    };
  });
}

let current: Page | undefined;

async function main() {
  const browser = await chromium.launch();
  process.on("exit", () => void browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(OBSERVER);
  const page = await context.newPage();
  current = page;
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(60_000);

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/tasks/);
  await page.getByRole("link", { name: new RegExp(BOARD.replace(/[()]/g, "\\$&")) }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  const boardUrl = page.url().split("?")[0];
  const cookie = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  // Server render: time to first byte and full HTML, with no browser involved.
  const server: { ttfb: number[]; total: number[]; bytes: number } = { ttfb: [], total: [], bytes: 0 };
  for (let i = 0; i < RUNS + 1; i++) {
    const t0 = performance.now();
    const res = await fetch(boardUrl, { headers: { cookie } });
    const reader = res.body!.getReader();
    let first = 0;
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (!first) first = performance.now() - t0;
      if (done) break;
      bytes += value.length;
    }
    if (i === 0) continue; // warm-up
    server.ttfb.push(first);
    server.total.push(performance.now() - t0);
    server.bytes = bytes;
  }

  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  // First load of the board (cold reload, server and browser).
  const loads: Awaited<ReturnType<typeof loadMetrics>>[] = [];
  for (let i = 0; i < RUNS; i++) {
    await page.goto(boardUrl, { waitUntil: "load" });
    await page.locator("[data-card-id]").first().waitFor();
    await page.waitForTimeout(1500);
    loads.push(await loadMetrics(page));
  }
  const load = Object.fromEntries(
    Object.keys(loads[0]).map((k) => [k, median(loads.map((l) => (l as Record<string, number>)[k] ?? NaN))])
  );

  const cards = page.locator("[data-column-id] [data-card-id]");
  const cardCount = await cards.count();
  const results: Record<string, unknown> = {};

  // Hover over a few cards (shows the card menu button).
  results.hover = await measure(page, async () => {
    for (let i = 0; i < 5; i++) await cards.nth(i).hover();
  });

  // Keyboard move: Space lifts, ArrowRight moves to the next column, Space drops.
  const first = cards.first().locator("a").first();
  await first.focus();
  results.keyboardPickUp = await measure(page, () => page.keyboard.press("Space"));
  results.keyboardMove = await measure(page, () => page.keyboard.press("ArrowRight"));
  results.keyboardDrop = await measure(page, () => page.keyboard.press("Space"), 800);

  // Pointer drag from the first column to the third.
  const from = await cards.nth(3).boundingBox();
  const target = await page.locator("[data-column-id]").nth(2).boundingBox();
  if (from && target) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    results.dragStart = await measure(page, async () => {
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 });
    });
    results.dragMove = await measure(page, () =>
      page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 20 })
    );
    results.drop = await measure(page, () => page.mouse.up(), 800);
  }

  // Open the card panel (intercepted route) and close it again.
  results.openCardPanel = await measure(
    page,
    async () => {
      await cards.nth(10).locator("a").first().click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("dialog").getByRole("heading").first().waitFor();
    },
    500
  );
  await page.keyboard.press("Escape");
  await page.waitForURL(boardUrl);
  await page.waitForTimeout(500);

  // Filtering: open the filter bar and type a query.
  await page.locator("body").press("/");
  const search = page.getByRole("searchbox").or(page.getByRole("textbox", { name: /filter|search/i })).first();
  await search.waitFor();
  results.filterType = await measure(page, () => search.pressSequentially("fix", { delay: 80 }));
  results.filterClear = await measure(page, () => search.fill(""));

  // Views.
  results.listView = await measure(page, async () => {
    await page.getByRole("radio", { name: "List", exact: true }).click();
    await page.locator("table, [role=grid]").first().waitFor();
  });
  results.calendarView = await measure(page, async () => {
    await page.getByRole("radio", { name: "Calendar", exact: true }).click();
    await page.waitForTimeout(100);
  });
  results.boardView = await measure(page, async () => {
    await page.getByRole("radio", { name: "Board", exact: true }).click();
    await page.locator("[data-column-id] [data-card-id]").first().waitFor();
  });

  // Command palette search.
  results.commandPaletteOpen = await measure(page, async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("dialog").waitFor();
  });
  // resultsAfterMs: from the last keystroke to the first card result (includes
  // the palette's 150ms debounce and the server search).
  let afterLastKey = 0;
  results.commandPaletteType = await measure(page, async () => {
    await page.keyboard.type("migrate", { delay: 60 });
    const t0 = Date.now();
    await page.getByRole("dialog").getByRole("option", { name: /Migrate/ }).first().waitFor();
    afterLastKey = Date.now() - t0;
  });
  (results.commandPaletteType as Record<string, number>).resultsAfterMs = afterLastKey;
  await page.keyboard.press("Escape");

  // My tasks.
  const myLoads: Awaited<ReturnType<typeof loadMetrics>>[] = [];
  for (let i = 0; i < RUNS; i++) {
    await page.goto(`${BASE}/tasks/me`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    myLoads.push(await loadMetrics(page));
  }
  const myTasks = Object.fromEntries(
    Object.keys(myLoads[0]).map((k) => [k, median(myLoads.map((l) => (l as Record<string, number>)[k] ?? NaN))])
  );

  console.log(
    JSON.stringify(
      {
        cpuThrottle: CPU,
        cards: cardCount,
        server: { ttfb: median(server.ttfb), total: median(server.total), bytes: server.bytes },
        boardLoad: load,
        interactions: results,
        myTasks,
      },
      null,
      2
    )
  );
  await browser.close();
}

main().catch(async (err) => {
  if (process.env.PERF_SCREENSHOT) await current?.screenshot({ path: process.env.PERF_SCREENSHOT }).catch(() => {});
  console.error(err);
  process.exit(1);
});
