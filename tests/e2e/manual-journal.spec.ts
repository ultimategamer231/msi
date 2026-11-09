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
    await fillExactly(page.locator("#manual-line-0-debit"), "300");
    await page.getByLabel("Line 2: Account").selectOption("1010-BR2");
    await fillExactly(page.locator("#manual-line-1-credit"), "300.00");
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await page
      .getByRole("region", { name: "Request a manual journal" })
      .getByRole("button", { name: "Send for approval" })
      .click();
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
    await fillExactly(page.locator("#manual-line-0-debit"), "300");
    await page.getByLabel("Line 2: Account").selectOption("1010-BR2");
    await fillExactly(page.locator("#manual-line-1-credit"), "200");
    await expect(page.getByText("Not balanced yet: difference $100.00")).toBeVisible();
    await page
      .getByRole("region", { name: "Request a manual journal" })
      .getByRole("button", { name: "Send for approval" })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Debits and credits do not balance." }),
    ).toBeVisible();

    await fillExactly(page.locator("#manual-line-1-debit"), "50");
    await page
      .getByRole("region", { name: "Request a manual journal" })
      .getByRole("button", { name: "Send for approval" })
      .click();
    await expect(
      page.getByText("Enter an amount in either the debit or the credit column, not both."),
    ).toBeVisible();
  });

  test("the accountant sends owner capital for approval (R10, R-14)", async ({ page }) => {
    const memo = `Owner capital ${unique()}`;
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/ledger?tab=manual");
    const panel = page.getByRole("region", { name: "Record owner capital" });
    await panel.getByLabel("Paid into").selectOption("1010-BR2");
    await fillExactly(panel.getByLabel("Amount ($)"), "2,000");
    await fillExactly(panel.getByLabel("Memo"), memo);
    await fillExactly(panel.getByLabel("Deposit or transfer reference (optional)"), "Slip 4411");
    await panel.getByRole("button", { name: "Send for approval" }).click();
    await expect(panel.getByRole("status").filter({ hasText: "Sent for approval." })).toBeVisible();
    const request = page.getByRole("listitem").filter({ hasText: `Capital in: ${memo}` });
    await expect(request).toContainText("$2,000.00");
    await expect(request).toContainText("Waiting for approval");
    await expectNoSeriousA11yIssues(page);
  });

  test("a manager does not get the manual journal form", async ({ page }) => {
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/ledger?tab=manual");
    await expect(page.getByRole("link", { name: "Manual journal" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Request a manual journal" })).toHaveCount(0);
  });

  test("before go-live the accountant posts opening balances; the difference goes to 3900 (FR-27, R12)", async ({
    page,
  }) => {
    const memo = `Excel book balances ${randomInt(100000, 999999)}`;
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/ledger?tab=opening");
    const panel = page.getByRole("region", { name: "Opening balances" });
    await fillExactly(panel.getByLabel("Memo (why this entry is needed)"), memo);
    await panel.getByLabel("Line 1: Account").selectOption("1030");
    await fillExactly(panel.getByLabel("Debit"), "150.00");
    await expect(panel.getByText("Opening balance equity (3900): $150.00")).toBeVisible();
    await panel.getByRole("button", { name: "Post opening balances" }).click();
    await expect(panel.getByText("Opening balances posted.")).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await page.goto("/ledger");
    await expect(page.getByText(memo).first()).toBeVisible();
  });
});
