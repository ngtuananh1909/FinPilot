import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a local production build (`next build && next start`) on http://localhost:3000.
 * Next.js reads .env.local itself; this file never reads or prints secrets.
 *
 * The app uses the ONE shared Supabase project, so tests create throwaway ANONYMOUS guests only
 * and delete exactly the user ids they created (tests/e2e/support/cleanup.ts). One worker, so
 * runs never overlap. Owner approval: G2 item (ii), 2026-11-24.
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [
    { name: "mobile-375", use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 }, browserName: "chromium" } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "npm run build && npx next start -p 3000",
    url: "http://localhost:3000",
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
