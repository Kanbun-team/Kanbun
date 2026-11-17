import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build on a fresh demo database
// (scripts/e2e-serve.sh). Tests share that database, so they run serially.
const PORT = 3456;

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "sh scripts/e2e-serve.sh",
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT) },
  },
});
