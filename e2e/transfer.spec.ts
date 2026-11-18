import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { axeViolations, column, loginAs } from "./helpers";

// Import, export and backup. The tests build on each other (one shared
// database, run in order): the Trello import creates the board the others use.
test.describe.configure({ mode: "serial" });

const TRELLO_FIXTURE = path.join(__dirname, "..", "src", "lib", "__tests__", "fixtures", "trello-board.json");
const BOARD = "Trello launch plan";

async function openImportedBoardSettings(page: Page) {
  await page.goto("/tasks");
  await page.getByRole("link", { name: new RegExp(BOARD) }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await page.goto(`${page.url()}/settings`);
  await expect(page.getByRole("heading", { name: "Import and export" })).toBeVisible();
}

test("imports a Trello board from the new board dialog", async ({ page }) => {
  await loginAs(page, "admin");
  await page.getByRole("button", { name: "New board" }).first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/tasks\/import$/);
  await expect(page.getByRole("heading", { name: "Import a board", level: 1 })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByLabel("Board file (.json)").setInputFiles(TRELLO_FIXTURE);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Trello board imported.")).toBeVisible();
  await expect(page.getByText("Left out because archived in Trello: 1 lists, 2 cards.")).toBeVisible();
  await expect(page.getByText(/No Kanbun user for: ghost_user/)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("link", { name: `Open ${BOARD}` }).click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await expect(column(page, "Ideas")).toBeVisible();
  await expect(column(page, "Doing")).toBeVisible();
  await expect(column(page, "Ideas").getByText("Design the landing page")).toBeVisible();
  await expect(column(page, "Doing").getByText("Build the signup flow")).toBeVisible();
  await expect(page.getByText("Archived card")).toHaveCount(0);
});

test("rejects a file that is not a board export", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/tasks/import");
  await page.getByLabel("Board file (.json)").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"hello": "world"}'),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Trello" })).toContainText("This does not look like a Trello board export.");
});

test("imports cards from CSV after a preview", async ({ page }) => {
  await loginAs(page, "admin");
  await openImportedBoardSettings(page);
  const csv = [
    "title;column;priority;deadline;tags;assignees",
    '"Plan, the launch";Ideas;high;2026-12-24;launch;admin',
    "Write the docs;Later;;;docs, launch;nobody",
    ";Ideas;;;;",
  ].join("\r\n");
  await page.getByLabel("CSV file").setInputFiles({ name: "cards.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

  await expect(page.getByText("2 cards will be imported. Rows skipped: 1. Warnings: 1.")).toBeVisible();
  await expect(page.getByLabel("Separator")).toHaveValue(";");
  await expect(page.getByLabel("Title (required)")).toHaveValue("0");
  const preview = page.getByRole("table", { name: "Preview" });
  await expect(preview.getByRole("cell", { name: "Plan, the launch" })).toBeVisible();
  await expect(preview.getByRole("cell", { name: "Later" })).toBeVisible();
  await expect(page.getByText('Line 3: "nobody" is not a member of this board, not assigned.')).toBeVisible();
  await expect(page.getByText("Line 4: no title, the row is skipped.")).toBeVisible();
  await expect(page.getByText("New columns: Later.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Import 2 cards" }).click();
  await expect(page.getByRole("status")).toContainText("2 cards imported");

  await page.getByRole("link", { name: new RegExp(BOARD) }).first().click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await expect(column(page, "Ideas").getByText("Plan, the launch")).toBeVisible();
  await expect(column(page, "Later").getByText("Write the docs")).toBeVisible();
});

test("exports a board as JSON and CSV, and the JSON imports as a new board", async ({ page }) => {
  await loginAs(page, "admin");
  await openImportedBoardSettings(page);

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download JSON" }).click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/^kanbun-trello-launch-plan-\d{4}-\d{2}-\d{2}\.json$/);
  const jsonPath = await jsonDownload.path();
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  expect(data).toMatchObject({ format: "kanbun-export", version: 1, kind: "board" });
  expect(data.boards[0].name).toBe(BOARD);
  expect(data.boards[0].columns.map((c: { name: string }) => c.name)).toEqual(["Ideas", "Doing", "Later"]);

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);
  const csv = readFileSync(await csvDownload.path(), "utf8");
  expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toBe(
    "title,description,column,priority,deadline,tags,assignees,checklist,created"
  );
  expect(csv).toContain('"Plan, the launch"');

  data.boards[0].name = "Re-imported plan";
  await page.goto("/tasks/import");
  await page.getByLabel("Board file (.json)").setInputFiles({
    name: "board.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 1 board(s).")).toBeVisible();
  await page.getByRole("link", { name: "Open Re-imported plan" }).click();
  await page.waitForURL(/\/tasks\/[^/]+$/);
  await expect(column(page, "Later").getByText("Write the docs")).toBeVisible();
});

test("admin backup downloads a non-empty archive", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/admin/data");
  await expect(page.getByRole("heading", { name: "Backup", exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download backup" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^kanbun-backup-.*\.tar\.gz$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.length).toBeGreaterThan(1024);
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // gzip

  const full = await page.request.get("/api/admin/export");
  expect(full.status()).toBe(200);
  const everything = await full.json();
  expect(everything.kind).toBe("full");
  expect(everything.users.some((u: { username: string }) => u.username === "admin")).toBe(true);
  expect(JSON.stringify(everything)).not.toContain("passwordHash");
});

test("members cannot download backups or full exports", async ({ page }) => {
  await loginAs(page, "marta");
  expect((await page.request.get("/api/admin/backup")).status()).toBe(403);
  expect((await page.request.get("/api/admin/export")).status()).toBe(403);
  await page.goto("/admin/data");
  await expect(page).toHaveURL(/\/tasks$/);
});
