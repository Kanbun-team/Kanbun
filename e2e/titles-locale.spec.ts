import { expect, test } from "@playwright/test";
import { axeViolations, card, loginAs, openDemoBoard } from "./helpers";

test.describe("login screen in the browser's language", () => {
  test.use({ locale: "pl-PL" });

  test("Polish browser gets a Polish login screen and errors", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Zaloguj się · Kanbun");
    await expect(page.locator("html")).toHaveAttribute("lang", /pl/);
    await page.getByLabel("Nazwa użytkownika").fill("admin");
    await page.getByLabel("Hasło").fill("wrong-password");
    await page.getByRole("button", { name: "Zaloguj", exact: true }).click();
    await expect(page.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("login screen in French", () => {
  test.use({ locale: "fr-CA" });

  test("a French browser gets a French login screen and errors", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Connexion · Kanbun");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await page.getByLabel("Nom d’utilisateur").fill("admin");
    await page.getByLabel("Mot de passe").fill("wrong-password");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page.getByText("Nom d’utilisateur ou mot de passe incorrect.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("login screen in Brazilian Portuguese", () => {
  test.use({ locale: "pt-BR" });

  test("a Portuguese browser gets a Portuguese login screen", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");
    await expect(page.getByLabel("Nome de usuário")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  });
});

test.describe("login screen fallback", () => {
  test.use({ locale: "ja-JP" });

  test("an unsupported language falls back to English", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Log in · Kanbun");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });
});

test("every page has its own document title", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page).toHaveTitle("Boards · Kanbun");
  await page.goto("/tasks/me");
  await expect(page).toHaveTitle("My tasks · Kanbun");
  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings · Kanbun");
  await page.goto("/trash");
  await expect(page).toHaveTitle("Trash · Kanbun");
  await page.goto("/whats-new");
  await expect(page).toHaveTitle("What's new · Kanbun");
  await page.goto("/admin/users");
  await expect(page).toHaveTitle("Users · Kanbun");
  await page.goto("/users/marta");
  await expect(page).toHaveTitle("Marta Nowak · Kanbun");
  await page.goto("/no-such-page");
  await expect(page).toHaveTitle("Page not found · Kanbun");

  await openDemoBoard(page);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  const boardUrl = page.url();

  // The card panel over the board, and the card page on its own.
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  await expect(page).toHaveTitle("Responsive navigation · Website relaunch · Kanbun");
  // Closing the panel brings the board's title back.
  await page.keyboard.press("Escape");
  await page.waitForURL(boardUrl);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.waitForURL(boardUrl);
  await expect(page).toHaveTitle("Website relaunch · Kanbun");
  await card(page, "In progress", "Responsive navigation").getByRole("link").click();
  await page.waitForURL(/\/cards\//);
  await page.reload();
  await expect(page).toHaveTitle("Responsive navigation · Website relaunch · Kanbun");

  await page.goto(`${boardUrl}/settings`);
  await expect(page).toHaveTitle("Board settings · Website relaunch · Kanbun");
});

test("the language picker names each language in that language and switches the UI", async ({ page }) => {
  // piotr, not admin, so a failure here can not leave the other tests in Spanish.
  await loginAs(page, "piotr");
  await page.goto("/settings");
  const language = (name: string) => page.getByRole("button", { name, exact: true });
  for (const name of ["English", "Italiano", "Polski", "Deutsch", "Français", "Español", "Português (Brasil)", "Nederlands", "Čeština", "Українська"]) {
    await expect(language(name)).toBeVisible();
  }
  try {
    await language("Español").click();
    await expect(page).toHaveTitle("Ajustes · Kanbun");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(language("Español")).toHaveAttribute("aria-pressed", "true");
    await language("Français").click();
    await expect(page).toHaveTitle("Paramètres · Kanbun");
  } finally {
    await language("English").click();
    await expect(page).toHaveTitle("Settings · Kanbun");
  }
});

test("client components get the user's language without shipping every translation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await loginAs(page, "piotr");
  await page.goto("/settings");
  const language = (name: string) => page.getByRole("button", { name, exact: true });
  try {
    await language("Čeština").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await page.goto("/tasks");
    await page.getByRole("link", { name: /Website relaunch/ }).first().click();
    await page.waitForURL(/\/tasks\/[^/]+$/);
    // Rendered only in the browser, after hydration.
    await expect(async () => {
      await page.locator("body").press("?");
      await expect(page.getByRole("dialog", { name: "Klávesové zkratky" })).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.keyboard.press("Escape");
    expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  } finally {
    await page.goto("/settings");
    await language("English").click();
    await expect(page).toHaveTitle("Settings · Kanbun");
  }
});
