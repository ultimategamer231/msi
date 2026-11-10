import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";

test.describe("audit log (FR-26; SPEC 9 /audit for manager, CEO, admin)", () => {
  for (const key of ["cashier", "loan_officer", "accountant"] as const) {
    test(`${key} cannot open the audit log`, async ({ page }) => {
      await signInAs(page, fixtureUser(key));
      await page.goto("/audit");
      await expect(page).toHaveURL(/\/dashboard\?notice=forbidden$/);
    });
  }

  for (const key of ["manager", "ceo"] as const) {
    test(`${key} can read the audit log, which offers no way to change entries`, async ({ page }) => {
      await signInAs(page, fixtureUser(key));
      await page.goto("/audit");
      await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
      await expect(page.getByText("Entries cannot be edited or deleted.")).toBeVisible();
      const main = page.locator("main");
      await expect(main.getByRole("button", { name: /delete|remove|edit|hide/i })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yIssues(page);
    });
  }

  test("a settings change made by the admin appears with its before and after values", async ({
    page,
    isMobile,
  }) => {
    const dollars = `1${randomInt(10, 99)}.${isMobile ? "11" : "22"}`;
    const cents = dollars.replace(".", "");
    await signInAs(page, fixtureUser("admin"));
    await page.goto("/settings?tab=rules");
    await fillExactly(page.getByLabel("Expenses recorded without manager approval, up to (A-20)"), dollars);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.goto("/audit");
    await page.getByLabel("Person").selectOption({ label: "Test Admin" });
    await page.getByLabel("Record type").selectOption({ label: "Setting" });
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/entity=setting/);
    for (const text of await page.locator("main ol > li").allTextContents())
      expect(text).toContain("Setting:");

    const entry = page
      .getByRole("listitem")
      .filter({ hasText: "Setting changed · Setting: approvals.expense_limit_cents" })
      .filter({ has: page.getByText(cents, { exact: true }) })
      .first();
    await entry.getByText("Show changes").click();
    await expect(entry.getByRole("cell", { name: cents, exact: true })).toBeVisible();
    await expect(entry).toContainText("Test Admin · Administrator");
  });
});
