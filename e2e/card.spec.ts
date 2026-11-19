import { expect, test, type Page } from "@playwright/test";
import { axeViolations, card, column, loginAs, openDemoBoard } from "./helpers";

// The card panel: searchable pickers, @mention autocomplete and the activity
// timeline. Each test uses its own demo card so the order of specs does not
// matter.

async function openCard(page: Page, columnName: string, title: string) {
  await card(page, columnName, title).getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  const panel = page.getByRole("dialog", { name: "Open card" });
  await expect(panel.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  return panel;
}

const saved = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST");

test.beforeEach(async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
});

test("add an assignee and a tag by typing in the pickers", async ({ page }) => {
  const panel = await openCard(page, "To do", "Hero section illustrations");

  await panel.getByRole("button", { name: "Add assignee" }).click();
  const members = page.getByRole("searchbox", { name: "Search members" });
  await expect(members).toBeFocused();
  await members.pressSequentially("jul");
  await expect(page.getByRole("option")).toHaveCount(1);
  let request = saved(page);
  await page.keyboard.press("Enter");
  await request;
  await expect(page.getByRole("option", { name: /Julia Kowalczyk/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape"); // clears the search
  await page.keyboard.press("Escape"); // closes the picker, not the panel
  await expect(members).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Remove: Julia Kowalczyk" })).toBeVisible();

  await panel.getByRole("button", { name: "Add tag" }).click();
  const tags = page.getByRole("searchbox", { name: "Search tags" });
  await tags.fill("zzz");
  await expect(page.getByText("No matches")).toBeVisible();
  await tags.fill("front");
  request = saved(page);
  await page.getByRole("option", { name: "Frontend" }).click();
  await request;
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Remove: Frontend" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Remove: Julia Kowalczyk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove: Frontend" })).toBeVisible();
});

test("add a blocking card by searching its title", async ({ page }) => {
  const panel = await openCard(page, "To do", "Hero section illustrations");
  await panel.getByRole("button", { name: "Add blocking card" }).click();
  const search = page.getByRole("searchbox", { name: "Search cards" });

  // The card itself is not offered.
  await search.fill("hero section");
  await expect(page.getByText("No matches")).toBeVisible();

  await search.fill("spam");
  const option = page.getByRole("option", { name: /Contact form spam protection/ });
  await expect(option).toContainText("In progress");
  await option.click();
  await expect(search).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Contact form spam protection" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "Activity" })).toContainText(
    "Ada Admin marked this card as blocked by Contact form spam protection"
  );

  // Already linked cards are not offered again.
  await panel.getByRole("button", { name: "Add blocking card" }).click();
  await page.getByRole("searchbox", { name: "Search cards" }).fill("spam");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

test("mention a member with the keyboard and see the highlighted mention", async ({ page }) => {
  const panel = await openCard(page, "In progress", "Migrate blog to MDX");
  const box = panel.getByLabel("Write a comment");
  await box.click();

  // Escape closes the suggestions only.
  await box.pressSequentially("@to");
  const list = page.getByRole("listbox", { name: "People to mention" });
  await expect(list.getByRole("option", { name: /Tomek/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(panel).toBeVisible();
  await box.fill("");

  const stamp = Date.now();
  await box.pressSequentially("Ready for review @ma");
  await expect(list.getByRole("option", { name: /Marta Nowak/ })).toBeVisible();
  await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(list.getByRole("option", { name: /Marta Nowak/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(box).toHaveValue("Ready for review @marta ");
  await box.pressSequentially(`please check ${stamp}`);
  await panel.getByRole("button", { name: "Post comment" }).click();

  const comment = panel.getByRole("listitem").filter({ hasText: String(stamp) });
  const mention = comment.getByRole("link", { name: "@marta" });
  await expect(mention).toHaveAttribute("href", "/users/marta");
  await expect(mention).toHaveClass(/mention/);
});

test("priority changes and moves show up in the activity timeline", async ({ page }) => {
  const title = "Audit current analytics events";
  let panel = await openCard(page, "Backlog", title);
  const request = saved(page);
  await panel.getByRole("button", { name: "High", exact: true }).click();
  await request;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await card(page, "Backlog", title).getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to" }).click();
  const dialog = page.getByRole("dialog");
  const select = dialog.getByLabel("Column");
  const todo = await select.locator("option", { hasText: "To do" }).textContent();
  await select.selectOption({ label: todo ?? "" });
  await dialog.getByRole("button", { name: "Move card" }).click();
  await expect(card(page, "To do", title)).toBeVisible();

  panel = await openCard(page, "To do", title);
  const timeline = panel.getByRole("list", { name: "Activity" });
  await expect(timeline).toContainText("Ada Admin changed the priority from Low to High");
  await expect(timeline).toContainText("Ada Admin moved this card from Backlog to To do");
  // Newest last: the move comes after the priority change.
  const text = (await timeline.textContent()) ?? "";
  expect(text.indexOf("moved this card")).toBeGreaterThan(text.indexOf("changed the priority"));

  await panel.getByRole("button", { name: "Comments only" }).click();
  await expect(timeline).not.toContainText("moved this card");
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`card panel accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("pickers and mention suggestions pass axe", async ({ page }) => {
      const report: Record<string, unknown> = {};
      const scan = async (name: string) => {
        const violations = await axeViolations(page);
        if (violations.length) report[name] = violations;
      };

      const panel = await openCard(page, "In progress", "Responsive navigation");
      await scan("timeline");

      await panel.getByRole("button", { name: "Add assignee" }).click();
      await page.getByRole("searchbox", { name: "Search members" }).fill("a");
      await expect(page.getByRole("option").first()).toBeVisible();
      await scan("assignee picker");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await panel.getByRole("button", { name: "Add blocking card" }).click();
      await expect(page.getByRole("option").first()).toBeVisible();
      await scan("blocking picker");
      await page.keyboard.press("Escape");

      const box = panel.getByLabel("Write a comment");
      await box.click();
      await box.pressSequentially("@");
      await expect(page.getByRole("listbox", { name: "People to mention" })).toBeVisible();
      await scan("mention suggestions");

      expect(report, JSON.stringify(report, null, 2)).toEqual({});
      await expect(column(page, "To do")).toBeAttached();
    });
  });
}

test("a comment sent again after its reply was lost is posted once", async ({ page }) => {
  const title = "Set up preview deployments";
  const panel = await openCard(page, "Done", title);
  const text = `Retried comment ${Date.now()}`;
  const box = panel.getByLabel("Write a comment");
  // The first send reaches the server, which saves the comment, but the
  // connection drops before the reply arrives.
  let dropped = false;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!dropped && req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes(text)) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.fallback();
  });
  await box.fill(text);
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByRole("region", { name: "Messages" })).toContainText("Could not reach the server");
  await expect(box).toHaveValue(text);
  expect(dropped).toBe(true);
  await page.unroute("**/*");

  // Sending the same draft again returns the saved comment instead of a second one.
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(box).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: text })).toHaveCount(1);
});
