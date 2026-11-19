import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { axeViolations, card, column, loginAs, openDemoBoard, toast } from "./helpers";

// Attachments and Checklists 2.0 in the card panel. Each test creates its own
// card so it does not depend on the other specs. The PostgreSQL CI job runs
// them with attachments in S3 (MinIO), the other job on the local disk.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function newCard(page: Page, title: string) {
  const backlog = column(page, "Backlog");
  await backlog.getByRole("button", { name: "Add card" }).click();
  await backlog.getByPlaceholder("Title").fill(title);
  await backlog.getByPlaceholder("Title").press("Enter");
  await expect(card(page, "Backlog", title)).toBeVisible();
  await page.keyboard.press("Escape");
  await card(page, "Backlog", title).getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  const panel = page.getByRole("dialog", { name: "Open card" });
  await expect(panel.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  return panel;
}

async function addItem(page: Page, panel: ReturnType<Page["getByRole"]>, title: string) {
  const input = panel.getByRole("textbox", { name: "Add subtask" });
  await input.fill(title);
  await input.press("Enter");
  await expect(panel.locator("[data-subtask-id]").filter({ hasText: title })).toBeVisible();
}

const itemTitles = (page: Page) => page.locator("[data-subtask-title]").allTextContents();

test.beforeEach(async ({ page }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
});

test("upload an image and a text file, download them and delete one", async ({ page }) => {
  const title = `Attachments ${Date.now()}`;
  const panel = await newCard(page, title);
  await expect(panel.getByText("No attachments yet.")).toBeVisible();

  await panel.getByTestId("attachment-input").setInputFiles([
    { name: "pixel.png", mimeType: "image/png", buffer: PNG },
    { name: "notes zażółć.txt", mimeType: "text/plain", buffer: Buffer.from("hello from kanbun\n") },
  ]);

  const thumb = panel.getByRole("img", { name: "pixel.png" });
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const fileLink = panel.getByRole("link", { name: "notes zażółć.txt", exact: true });
  await expect(fileLink).toBeVisible();
  await expect(panel.getByRole("list", { name: "Files" })).toContainText("Added by Ada Admin");

  // The text file downloads with its exact bytes and safe headers.
  const fileUrl = await fileLink.getAttribute("href");
  const download = await page.request.get(fileUrl!);
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe("hello from kanbun\n");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment; filename="notes za____.txt"; filename\*=UTF-8''notes%20za/);
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect(download.headers()["content-type"]).toBe("text/plain");

  // The image is served inline as a PNG.
  const imageUrl = await panel.getByRole("link", { name: "Open pixel.png" }).getAttribute("href");
  const image = await page.request.get(imageUrl!);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["content-disposition"]).toMatch(/^inline;/);
  expect(Buffer.compare(await image.body(), PNG)).toBe(0);

  // Activity and the paperclip count on the card face.
  await expect(panel.getByRole("list", { name: "Activity" })).toContainText("Ada Admin attached pixel.png");
  await expect(card(page, "Backlog", title)).toContainText("2 attachments");

  // Axe on the card with attachments and a checklist item.
  await addItem(page, panel, "Check the upload");
  expect(await axeViolations(page)).toEqual([]);

  // Delete the text file: confirm, then the row and the file are gone.
  await panel.getByRole("button", { name: "Delete notes zażółć.txt" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete this attachment?");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(toast(page)).toContainText("Attachment deleted");
  await expect(fileLink).toHaveCount(0);
  expect((await page.request.get(fileUrl!)).status()).toBe(404);
  await expect(card(page, "Backlog", title)).toContainText(/1 attachment(?!s)/);

  // Trashing the card keeps the file; undo brings the attachment back.
  await panel.getByRole("button", { name: "Delete card" }).click();
  await expect(toast(page)).toContainText("Card deleted");
  expect((await page.request.get(imageUrl!)).status()).toBe(404);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "Backlog", title)).toContainText(/1 attachment(?!s)/);
  const restored = await page.request.get(imageUrl!);
  expect(restored.status()).toBe(200);
  expect(Buffer.compare(await restored.body(), PNG)).toBe(0);
});

test("large images get a small server-side thumbnail, kept through trash and restore", async ({ page }) => {
  const title = `Thumbnail ${Date.now()}`;
  const panel = await newCard(page, title);
  const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .png()
    .toBuffer();
  await panel.getByTestId("attachment-input").setInputFiles([
    { name: "photo.png", mimeType: "image/png", buffer: photo },
    { name: "pixel.png", mimeType: "image/png", buffer: PNG },
  ]);

  // The panel shows the 480px WebP preview; the link still opens the original.
  const tile = panel.getByRole("img", { name: "photo.png" });
  await expect(tile).toHaveAttribute("src", /\?thumb=1$/);
  await expect.poll(() => tile.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
  const thumbUrl = (await tile.getAttribute("src"))!;
  const thumb = await page.request.get(thumbUrl);
  expect(thumb.headers()["content-type"]).toBe("image/webp");
  expect(thumb.headers()["content-disposition"]).toMatch(/^inline;/);
  expect(thumb.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await thumb.body()).length).toBeLessThan(photo.length);
  const originalUrl = (await panel.getByRole("link", { name: "Open photo.png" }).getAttribute("href"))!;
  const original = await page.request.get(originalUrl);
  expect(original.headers()["content-type"]).toBe("image/png");
  expect(Buffer.compare(await original.body(), photo)).toBe(0);

  // A small image needs no thumbnail: the original is served for it.
  const small = await page.request.get((await panel.getByRole("img", { name: "pixel.png" }).getAttribute("src"))!);
  expect(small.headers()["content-type"]).toBe("image/png");
  expect(Buffer.compare(await small.body(), PNG)).toBe(0);
  // Asking for a download never gives the thumbnail.
  const download = await page.request.get(`${thumbUrl}&download=1`);
  expect(download.headers()["content-type"]).toBe("image/png");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment;/);

  // Trash and undo: the thumbnail comes back with the card.
  await panel.getByRole("button", { name: "Delete card" }).click();
  await expect(toast(page)).toContainText("Card deleted");
  expect((await page.request.get(thumbUrl)).status()).toBe(404);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "Backlog", title)).toContainText("2 attachments");
  const restored = await page.request.get(thumbUrl);
  expect(restored.status()).toBe(200);
  expect(restored.headers()["content-type"]).toBe("image/webp");
});

test.describe("dark theme", () => {
  test.use({ colorScheme: "dark" });

  test("card with attachments and a checklist passes axe", async ({ page }) => {
    const panel = await newCard(page, `Dark attachments ${Date.now()}`);
    await panel.getByTestId("attachment-input").setInputFiles([
      { name: "pixel.png", mimeType: "image/png", buffer: PNG },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
    ]);
    await expect(panel.getByRole("link", { name: "notes.txt", exact: true })).toBeVisible();
    await addItem(page, panel, "Dark item");
    expect(await axeViolations(page)).toEqual([]);
  });
});

test("uploads need a session", async ({ browser }) => {
  const context = await browser.newContext();
  const res = await context.request.post("/api/attachments?cardId=x", { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") } } });
  expect(res.status()).toBe(401);
  await context.close();
});

test("checklist items get an assignee and a due date, reorder by keyboard and become cards", async ({ page, browser }) => {
  const stamp = Date.now();
  const title = `Checklist ${stamp}`;
  const panel = await newCard(page, title);
  const [a, b, c] = [`Alpha ${stamp}`, `Bravo ${stamp}`, `Charlie ${stamp}`];
  for (const item of [a, b, c]) await addItem(page, panel, item);
  await expect(panel.getByRole("progressbar", { name: "Subtasks" })).toHaveAttribute("aria-valuetext", "0 of 3 subtasks done");
  await panel.getByRole("checkbox", { name: `Done: ${a}` }).check();
  await expect(panel.getByRole("progressbar", { name: "Subtasks" })).toHaveAttribute("aria-valuetext", "1 of 3 subtasks done");

  // Assignee through the searchable picker, due date through the date picker.
  await panel.getByRole("button", { name: `Assignee for ${b}` }).click();
  await page.getByRole("searchbox", { name: "Search members" }).pressSequentially("jul");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: `Assignee for ${b}: Julia Kowalczyk` })).toBeVisible();
  // Julia hears about it, naming the item.
  const julia = await browser.newPage();
  await loginAs(julia, "julia");
  await julia.getByRole("button", { name: "Notifications" }).click();
  await expect(
    julia.getByRole("list", { name: "Notifications" }).getByText(`Ada Admin assigned you "${b}" on "${title}"`)
  ).toBeVisible();
  await julia.close();
  await panel.getByRole("button", { name: `Due date for ${b}` }).click();
  await page.getByRole("dialog", { name: `Due date for ${b}` }).getByRole("button", { name: /Tomorrow/ }).click();
  await expect(panel.locator("[data-subtask-id]").filter({ hasText: b })).toContainText("Tomorrow");

  // An item assigned to me shows up in My work.
  await panel.getByRole("button", { name: `Assignee for ${c}` }).click();
  await page.getByRole("searchbox", { name: "Search members" }).pressSequentially("ada");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: `Assignee for ${c}: Ada Admin` })).toBeVisible();

  // Keyboard reorder from the item menu: Charlie moves above Bravo.
  await panel.getByRole("button", { name: `Actions for ${c}` }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => itemTitles(page)).toEqual([a, c, b]);

  // Keyboard drag on the handle: Space, ArrowUp, Space moves Charlie to the top.
  await panel.getByRole("button", { name: `Reorder ${c}` }).focus();
  const live = page.locator("[id^=DndLiveRegion]");
  await page.keyboard.press("Space");
  await expect(live.filter({ hasText: `${c} moved to position 2 of 3` })).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await expect(live.filter({ hasText: `${c} moved to position 1 of 3` })).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect.poll(() => itemTitles(page)).toEqual([c, a, b]);
  await page.reload();
  await expect.poll(() => itemTitles(page)).toEqual([c, a, b]);

  await page.goto("/tasks/me");
  const mine = page.getByRole("region", { name: "Subtasks" });
  await expect(mine).toContainText(c);
  await expect(mine).toContainText(`On ${title}`);
  await mine.getByRole("link", { name: new RegExp(c) }).click();
  await page.waitForURL(/\/cards\//);

  // Convert Bravo into a card: same column, keeps assignee and deadline.
  const view = page.getByRole("main");
  await view.getByRole("button", { name: `Actions for ${b}` }).click();
  await page.getByRole("menuitem", { name: "Convert to card" }).click();
  await expect(toast(page)).toContainText(`Card created from ${b}`);
  await expect(view.locator("[data-subtask-id]").filter({ hasText: b })).toHaveCount(0);
  await expect(view.getByRole("list", { name: "Activity" })).toContainText(`Ada Admin turned the subtask ${b} into a card`);
  await toast(page).getByRole("button", { name: "Open card" }).click();
  await expect(page.getByRole("heading", { name: b, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove: Julia Kowalczyk" })).toBeVisible();

  await openDemoBoard(page);
  await expect(card(page, "Backlog", b)).toContainText("Tomorrow");
});
