import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";

/** Escapes every RegExp metacharacter, backslash included (CodeQL js/incomplete-sanitization). */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REPORTS = [
  ["collections", "Daily collections"],
  ["money-out", "Daily payments (money out)"],
  ["due", "Due loans"],
  ["overdue", "Overdue balances"],
  ["profit-loss", "Profit and loss"],
  ["balance-sheet", "Balance sheet"],
  ["trial-balance", "Trial balance"],
  ["cash-position", "Cash position"],
  ["collateral", "Collateral register"],
] as const;

test.describe("reports (SPEC 10.2; mock-up 15; FR-24)", () => {
  test("the accountant opens every report; the books balance; CSV downloads", async ({ page }, testInfo) => {
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/reports");
    for (const [key, title] of REPORTS) {
      await expect(page.getByRole("link", { name: new RegExp(`^${escapeRegExp(title)}`) })).toHaveAttribute(
        "href",
        `/reports/${key}`,
      );
    }
    await expectNoSeriousA11yIssues(page);

    for (const [key, title] of REPORTS) {
      await page.goto(`/reports/${key}`);
      await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
      const csv = await page.request.get(`/api/reports/${key}`);
      expect(csv.status(), key).toBe(200);
      expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
      expect(await csv.text()).toContain(title);
    }

    await page.goto("/reports/trial-balance");
    await expect(
      page.getByRole("status").filter({ hasText: "Balanced: debits equal credits" }),
    ).toBeVisible();
    await page.goto("/reports/balance-sheet");
    await expect(
      page.getByRole("status").filter({ hasText: "Balanced: assets equal liabilities plus equity" }),
    ).toBeVisible();
    await page.goto("/reports/overdue");
    await expect(page.getByRole("region", { name: "By age", exact: true })).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);
  });

  test("a cashier cannot open reports or export them", async ({ page }) => {
    await signInAs(page, fixtureUser("cashier"));
    const csv = await page.request.get("/api/reports/trial-balance");
    expect(csv.status()).toBe(403);
    await page.goto("/reports/trial-balance");
    await expect(page.getByRole("heading", { level: 2, name: "Trial balance" })).toHaveCount(0);
  });
});
