import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, expectNoSeriousA11yIssues } from "./helpers";

test.describe("foundation", () => {
  test("unknown routes show the designed not-found page", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("security headers are sent on every response", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
