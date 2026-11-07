import { defineConfig, devices } from "@playwright/test";

import { localSupabaseEnv } from "./tests/e2e/supabase-env";

/*
 * The demo payment check (docs/DEMO_DATA.md "Seeded state"): run once on a freshly seeded demo
 * database (`pnpm seed:demo --as-of 2026-02-12`), at 390 px as in mock-ups 03 and 04. No global
 * setup, so no test accounts are added to the demo data. Needs Grace Flomo's demo password:
 * DEMO_GRACE_PASSWORD=... pnpm test:demo
 */
const port = Number(process.env.PORT ?? 3000);
const supabase = localSupabaseEnv();

export default defineConfig({
  testDir: "tests/demo",
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`,
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
          command: `pnpm start --port ${port}`,
          port,
          reuseExistingServer: true,
          env: { NEXT_PUBLIC_SUPABASE_URL: supabase.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey },
          timeout: 120_000,
        }
      : undefined,
});
