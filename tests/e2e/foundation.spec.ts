import { expect, test } from "@playwright/test";

test.describe("foundation", () => {
  test("signed-out visitors to any page are sent to sign in", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page).toHaveURL(/\/login\?next=%2Fthis-route-does-not-exist$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("security headers are sent on every response", async ({ page }) => {
    const response = await page.goto("/login");
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
