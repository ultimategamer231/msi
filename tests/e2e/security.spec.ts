import { expect, test } from "@playwright/test";

test.describe("hardening (SPEC 11)", () => {
  test("security headers are sent on every page", async ({ request }) => {
    const response = await request.get("/login");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("/api/health answers without signing in", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; database: string };
    expect(body).toMatchObject({ status: "ok", database: "ok" });
  });

  test("five wrong passwords lock the account for 15 minutes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone-390", "one lockout per run is enough");
    // An address no one uses, unique per run: the lock is kept per email, whether or not it exists.
    const email = `locked-${Date.now()}@example.test`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("wrong-password-123");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /./ })).toBeVisible();
    }
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Too many attempts. Wait a few minutes, then try again.")).toBeVisible();
  });
});
