import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build on a fresh demo database
// (scripts/e2e-serve.sh). Tests share that database, so they run serially.
const PORT = Number(process.env.E2E_PORT ?? 3456);
// A second server on an empty database (no users) for the first-run setup flow.
const SETUP_PORT = PORT + 1;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "setup",
      testMatch: /setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${SETUP_PORT}` },
    },
  ],
  webServer: [
    {
      command: "sh scripts/e2e-serve.sh",
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { PORT: String(PORT) },
    },
    {
      command: "sh scripts/e2e-serve.sh",
      url: `http://localhost:${SETUP_PORT}/setup`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { PORT: String(SETUP_PORT), E2E_EMPTY: "1" },
    },
  ],
});
