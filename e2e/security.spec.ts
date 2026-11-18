import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { loginAs, openDemoBoard, toast } from "./helpers";

// Security headers, the Content-Security-Policy and the fixes from the v1.0
// security review (see SECURITY.md).

/** Collects CSP violations reported on the page and in the console. */
function watchCsp(page: Page) {
  const problems: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (/Content Security Policy|Content-Security-Policy|nonce/i.test(text)) problems.push(text);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []);

test("pages send a nonce-based CSP and the security headers", async ({ page }) => {
  const res = await page.goto("/login");
  const headers = res!.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("unsafe-eval");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();

  // A fresh nonce on every request.
  const again = await page.request.get("/login");
  expect(again.headers()["content-security-policy"]).not.toBe(csp);
});

test("main pages run under the CSP without violations", async ({ page }) => {
  await recordViolations(page);
  const problems = watchCsp(page);
  await loginAs(page, "admin");
  await openDemoBoard(page);
  // Open a card (panel), then the full pages people use most.
  await page.locator("[data-card-id]").first().click();
  await expect(page).toHaveURL(/\/cards\//);
  await page.keyboard.press("Escape");
  for (const path of ["/tasks", "/tasks/me", "/settings", "/trash", "/admin/users", "/admin/audit", "/admin/data", "/whats-new"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    // The theme script and Next.js scripts carry the nonce, so the app is interactive.
    await expect(page.locator("html")).toHaveAttribute("lang", /.+/);
  }
  // Wait for late violation reports.
  await page.waitForTimeout(300);
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);

  // Control: injected markup with an inline handler (what an XSS would add) does not run.
  const ran = await page.evaluate(async () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="/no-such-image.png" onerror="window.__injected = true">';
    document.body.appendChild(div);
    await new Promise((r) => setTimeout(r, 500));
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(ran).toBe(false);
  expect((await violations(page)).some((v) => v.startsWith("script-src"))).toBe(true);
});

test("avatar URLs must be https", async ({ page }) => {
  await loginAs(page, "tomek");
  await page.goto("/settings");
  const avatar = page.locator('input[name="avatarUrl"]');
  const previous = await avatar.inputValue();
  await avatar.fill("javascript:alert(document.cookie)");
  await avatar.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
  await expect(toast(page)).toContainText("The avatar must be an https address of an image.");
  await page.reload();
  await expect(page.locator('input[name="avatarUrl"]')).toHaveValue(previous);
});

test("login keeps redirects on this site", async ({ page }) => {
  await page.goto("/login?from=" + encodeURIComponent("/\\example.com/"));
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/tasks/);
});

test("cookie-authenticated POST routes refuse other origins", async ({ page }) => {
  await loginAs(page, "admin");
  const evil = { origin: "https://evil.example" };
  expect((await page.request.post("/api/session/heartbeat", { headers: evil })).status()).toBe(403);
  expect((await page.request.post("/api/import", { headers: evil, data: "{}" })).status()).toBe(403);
  expect((await page.request.post("/api/attachments?cardId=x", { headers: evil })).status()).toBe(403);
  // Same origin still works.
  expect((await page.request.post("/api/session/heartbeat")).status()).toBe(200);
});

test("an attachment upload without a length is cut off at the size limit", async ({ page, baseURL }) => {
  await loginAs(page, "admin");
  await openDemoBoard(page);
  const cardId = await page.locator("[data-card-id]").first().getAttribute("data-card-id");
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  // A chunked multipart body (no Content-Length) larger than the 10 MB default.
  const boundary = "----kanbunsecuritytest";
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) controller.enqueue(head);
      if (sent >= 12) {
        controller.enqueue(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  const res = await fetch(`${baseURL}/api/attachments?cardId=${cardId}`, {
    method: "POST",
    headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  } as RequestInit);
  expect(res.status).toBe(413);
});
