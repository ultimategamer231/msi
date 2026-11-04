import { defineConfig, devices } from "@playwright/test";

/*
 * E2E and accessibility checks run at the two widths the mock-ups use:
 * 390 px (phone) and 1280 px (desktop). CI runs against `pnpm start` after a build.
 */
const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const isCI = process.env.CI !== undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "en-GB",
    timezoneId: "Africa/Monrovia",
  },
  projects: [
    {
      name: "phone-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "desktop-1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer:
    process.env.PLAYWRIGHT_BASE_URL === undefined
      ? {
          command: isCI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
          port,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        }
      : undefined,
});
