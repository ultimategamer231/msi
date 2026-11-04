import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";

const unique = () => `${Date.now().toString(36)}${randomInt(1000, 9999)}`;

test.describe("manual journal request (SPEC 4: accountant, admin; R11)", () => {
  test("the accountant sends a balanced manual journal for approval", async ({ page }) => {
    const memo = `Rent correction ${unique()}`;
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/ledger?tab=manual");
    await expect(page.getByRole("heading", { name: "Request a manual journal" })).toBeVisible();

    await fillExactly(page.getByLabel("Memo (why this entry is needed)"), memo);
    await page.getByLabel("Line 1: Account").selectOption("5010");
    await fillExactly(page.locator("#line-0-debit"), "300");
    await page.getByLabel("Line 2: Account").selectOption("1010-BR2");
    await fillExactly(page.locator("#line-1-credit"), "300.00");
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Sent for approval. A manager will review it." }),
    ).toBeVisible();

    const request = page.getByRole("listitem").filter({ hasText: memo });
    await expect(request).toContainText("$300.00");
    await expect(request).toContainText("Waiting for approval");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("unbalanced and malformed lines are refused", async ({ page }) => {
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/ledger?tab=manual");
    await fillExactly(page.getByLabel("Memo (why this entry is needed)"), `Unbalanced ${unique()}`);
    await page.getByLabel("Line 1: Account").selectOption("5010");
    await fillExactly(page.locator("#line-0-debit"), "300");
    await page.getByLabel("Line 2: Account").selectOption("1010-BR2");
    await fillExactly(page.locator("#line-1-credit"), "200");
    await expect(page.getByText("Not balanced yet: difference $100.00")).toBeVisible();
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Debits and credits do not balance." }),
    ).toBeVisible();

    await fillExactly(page.locator("#line-1-debit"), "50");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByText("Enter an amount in either the debit or the credit column, not both."),
    ).toBeVisible();
  });

  test("a manager does not get the manual journal form", async ({ page }) => {
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/ledger?tab=manual");
    await expect(page.getByRole("link", { name: "Manual journal" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Request a manual journal" })).toHaveCount(0);
  });
});
