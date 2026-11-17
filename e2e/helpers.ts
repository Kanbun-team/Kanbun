import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const PASSWORD = "demo1234";

export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function loginAs(page: Page, username: string) {
  await login(page, username);
  await expect(page).toHaveURL(/\/tasks/);
}

export async function openDemoBoard(page: Page) {
  await page.goto("/tasks");
  await page.getByRole("link", { name: /Website relaunch/ }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await expect(page.getByRole("region", { name: "To do" })).toBeVisible();
}

export function column(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

/** WCAG 2.2 A/AA violations on the current page, summarized. */
export async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
  return summary;
}

/** Pointer drag in small steps, the way a person drags (dnd-kit needs real moves). */
export async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("drag: element not visible");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 15 });
  await page.mouse.up();
}

export function card(page: Page, columnName: string, title: string) {
  return column(page, columnName).locator("[data-card-id]").filter({ hasText: title });
}

/** The app's toast (dnd-kit has its own role=status live region). */
export function toast(page: Page) {
  return page.getByRole("region", { name: "Messages" });
}
