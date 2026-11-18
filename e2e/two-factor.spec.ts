import { expect, test, type Page } from "@playwright/test";
import { axeViolations, login, loginAs, PASSWORD, toast } from "./helpers";
import { base32Decode, totp } from "../src/lib/totp";

// tomek is used only here, and every test leaves two-factor turned off again.
const USER = "tomek";

function codeAt(secret: string, offsetMs = 0) {
  return totp(base32Decode(secret), Date.now() + offsetMs);
}

async function signOut(page: Page) {
  await page.context().clearCookies();
}

async function startSetup(page: Page): Promise<string> {
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Two-factor authentication" });
  await section.getByRole("button", { name: "Set up" }).click();
  const secretEl = section.getByTestId("totp-secret");
  await expect(secretEl).toBeVisible();
  await expect(section.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Open in authenticator app" })).toHaveAttribute("href", /^otpauth:\/\/totp\//);
  return (await secretEl.getAttribute("data-secret"))!;
}

async function submitCode(page: Page, code: string) {
  await page.getByLabel("Authentication code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
}

// Runs in both themes so the axe scans cover light and dark colors.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`(${colorScheme})`, () => {
    test.use({ colorScheme });

    test("two-factor: enable, sign in with a code, recovery code works once, disable", async ({ page }) => {
      await loginAs(page, USER);
      const secret = await startSetup(page);
      const section = page.getByRole("region", { name: "Two-factor authentication" });
      expect(await axeViolations(page), "settings 2FA setup").toEqual([]);

      // A wrong code does not turn it on.
      const wrong = String((Number(codeAt(secret)) + 1) % 1_000_000).padStart(6, "0");
      await section.getByLabel("6-digit code").fill(wrong);
      await section.getByRole("button", { name: "Turn on" }).click();
      await expect(toast(page)).toContainText("not right");

      await section.getByLabel("6-digit code").fill(codeAt(secret));
      await section.getByRole("button", { name: "Turn on" }).click();
      const codesList = section.getByRole("list", { name: "Your recovery codes" });
      await expect(codesList).toBeVisible();
      const recovery = await codesList.locator("[data-recovery-code]").allTextContents();
      expect(recovery).toHaveLength(10);
      await expect(section.getByText(/^On since/)).toBeVisible();
      expect(await axeViolations(page), "settings recovery codes").toEqual([]);
      await section.getByRole("button", { name: "I saved my codes" }).click();
      await expect(codesList).toHaveCount(0);

      // Password alone is not enough any more: the form asks for the code.
      await signOut(page);
      await login(page, USER);
      await expect(page.getByLabel("Authentication code")).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
      expect(await axeViolations(page), "login code step").toEqual([]);

      await submitCode(page, wrong);
      await expect(page.getByText("That code is not valid.", { exact: false })).toBeVisible();
      await expect(page).toHaveURL(/\/login/);

      // The setup used the current step; the next one is inside the accepted window.
      await submitCode(page, codeAt(secret, 30_000));
      await expect(page).toHaveURL(/\/tasks/);

      // A recovery code works in place of the app code, once.
      await signOut(page);
      await login(page, USER);
      await submitCode(page, recovery[0].toUpperCase());
      await expect(page).toHaveURL(/\/tasks/);

      await signOut(page);
      await login(page, USER);
      await submitCode(page, recovery[0]);
      await expect(page.getByText("That code is not valid.", { exact: false })).toBeVisible();
      await submitCode(page, recovery[1]);
      await expect(page).toHaveURL(/\/tasks/);

      // Turn it off with the password.
      await page.goto("/settings");
      await expect(section.getByText("8 unused recovery codes left.")).toBeVisible();
      await section.getByLabel("Current code, recovery code or password").fill(PASSWORD);
      await section.getByRole("button", { name: "Turn off" }).click();
      await expect(toast(page)).toContainText("Two-factor authentication is off");
      await expect(section.getByRole("button", { name: "Set up" })).toBeVisible();

      await signOut(page);
      await loginAs(page, USER);
    });
  });
}

test("two-factor: an admin can reset it for a user", async ({ page, browser }) => {
  await loginAs(page, USER);
  const secret = await startSetup(page);
  const section = page.getByRole("region", { name: "Two-factor authentication" });
  await section.getByLabel("6-digit code").fill(codeAt(secret));
  await section.getByRole("button", { name: "Turn on" }).click();
  await expect(section.getByRole("list", { name: "Your recovery codes" })).toBeVisible();

  const admin = await browser.newPage();
  await loginAs(admin, "admin");
  await admin.goto("/admin/users");
  const row = admin.getByRole("listitem").filter({ hasText: `@${USER}` });
  await expect(row.getByText("2FA", { exact: true })).toBeVisible();
  await row.locator("summary").click();
  await expect(row.getByText("Two-factor authentication: on")).toBeVisible();
  await row.getByRole("button", { name: "Reset two-factor" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Reset two-factor" }).click();
  await expect(toast(admin)).toContainText("Two-factor authentication reset");
  await expect(row.getByText("Two-factor authentication: off")).toBeVisible();
  await admin.close();

  await signOut(page);
  await loginAs(page, USER);
});

test("single sign-on stays hidden without OIDC configuration", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in with/ })).toHaveCount(0);
  // An SSO error code in the URL is explained instead of ignored.
  await page.goto("/login?error=SsoSignupDisabled");
  await expect(page.getByText("new accounts can not be created", { exact: false })).toBeVisible();

  await loginAs(page, "julia");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected accounts" })).toHaveCount(0);
});
