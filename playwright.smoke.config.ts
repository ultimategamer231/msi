import { defineConfig, devices } from "@playwright/test";

import { localSupabaseEnv } from "./tests/e2e/supabase-env";

/*
 * The end-to-end smoke run (SPEC 12.3). It moves the business clock (test environments only), so
 * it runs alone, one worker, after the main e2e suite: `pnpm test:smoke`. Same test accounts.
 */
const port = Number(process.env.PORT ?? 3000);
const isCI = process.env.CI !== undefined;
const supabase = localSupabaseEnv();

export default defineConfig({
  testDir: "tests/smoke",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  timeout: 120_000,
  reporter: isCI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`,
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
  ],
  webServer:
    process.env.PLAYWRIGHT_BASE_URL === undefined
      ? {
          command: isCI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
          port,
          reuseExistingServer: !isCI,
          env: { NEXT_PUBLIC_SUPABASE_URL: supabase.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey },
          timeout: 120_000,
        }
      : undefined,
});
