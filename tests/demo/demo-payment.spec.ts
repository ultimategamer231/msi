import { expect, test } from "@playwright/test";

/*
 * DEMO_DATA "Payments": on A (12 Feb 2026) at 14:52 Grace Flomo takes Mariama Kollie's $500.00 by
 * mobile money (OM-7731904) on LN-BR2-00009. It allocates penalty 240.00, interest 200.00,
 * principal 60.00, leaves $940.00 owed, and issues RCT-BR2-000123 (mock-ups 03 and 04).
 */
test("Mariama Kollie's demo payment issues RCT-BR2-000123 and leaves $940.00", async ({ page }) => {
  const password = process.env.DEMO_GRACE_PASSWORD;
  test.skip(password === undefined || password === "", "set DEMO_GRACE_PASSWORD from the demo seed output");

  await page.goto("/login");
  await page.getByLabel("Email").fill("grace.flomo@msi-demo.test");
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/payments/new?q=Mariama");
  await page.getByRole("link", { name: /LN-BR2-00009/ }).click();
  await expect(page.getByRole("region", { name: "Mariama Kollie" }).getByText("$1,440.00")).toBeVisible();
  await page.getByLabel("Amount (USD)").fill("500.00");
  await page.getByText("Mobile money", { exact: true }).click();
  await page.getByLabel("Transaction reference (required)").fill("OM-7731904");
  const preview = page.getByRole("region", { name: "Allocation preview" });
  await expect(preview.getByText("$940.00")).toBeVisible();
  await expect(preview.getByText("$240.00")).toBeVisible();
  await expect(preview.getByText("$60.00")).toBeVisible();
  await page.getByRole("button", { name: "Receive payment" }).click();

  await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
  const sheet = page.getByRole("article", { name: "RCT-BR2-000123" });
  await expect(sheet.getByText("Mobile money · OM-7731904")).toBeVisible();
  await expect(sheet.getByText("$500.00")).toBeVisible();
  await expect(sheet.getByText("$940.00")).toBeVisible();
  await expect(sheet.getByText("Grace Flomo")).toBeVisible();
});
