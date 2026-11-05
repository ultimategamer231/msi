import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { createTestCustomer, serviceClient } from "./service";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Hawa",
    last_name: `Wizard${n}`,
    phone: `0993 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-W${n}`,
  };
}

test.describe("new loan wizard (SPEC 9 /loans/new; FR-07, FR-09)", () => {
  test("a loan officer applies with a live preview, new collateral and a guarantor", async ({ page }) => {
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/loans/new?customer=${customer.id}`);
    await expect(page.getByRole("heading", { name: "Step 2 of 5: Amount and term" })).toBeVisible();

    await fillExactly(page.getByLabel("Amount to lend ($)"), "1,000");
    const preview = page.locator("[aria-live=polite]").filter({ hasText: "Total to repay" });
    await expect(preview).toContainText("$200.00");
    await expect(preview).toContainText("$1,200.00");
    await expect(preview).toContainText("the first penalty of $240.00");
    await expect(preview).toContainText("A manager approves loans up to $2,000.00.");
    await fillExactly(page.getByLabel("Purpose (optional)"), "Market stock");
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Step 3 of 5: Collateral" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Add at least one collateral item.")).toBeVisible();
    await page.getByRole("button", { name: "Add a new item" }).click();
    await page.getByLabel("Type").selectOption("electronics");
    await fillExactly(page.getByLabel("Description"), "Honda EU22i generator");
    await fillExactly(page.getByLabel("Serial number (optional)"), `GA-${fields.id_number}`);
    await fillExactly(page.getByLabel("Estimated value ($)"), "1400");
    await fillExactly(page.getByLabel("Where it is kept (optional)"), "Branch 2 safe");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("button", { name: "Remove Honda EU22i generator" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Step 4 of 5: Guarantors" })).toBeVisible();
    await page.getByRole("button", { name: "Add guarantor" }).click();
    await fillExactly(page.getByLabel("Full name"), "Joseph Kollie");
    await fillExactly(page.getByRole("textbox", { name: "Phone", exact: true }), "0770 555 014");
    await fillExactly(page.getByLabel("Relationship to the borrower (optional)"), "Brother");
    await page
      .getByLabel("Guarantor's ID scan (optional)")
      .setInputFiles({ name: "joseph-id.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByRole("heading", { name: "Step 5 of 5: Check and send" })).toBeVisible();
    await expect(page.getByText(`${fields.first_name} ${fields.last_name} (${customer.code})`)).toBeVisible();
    await expect(page.getByText("Joseph Kollie")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Send for approval" }).click();

    await expect(page).toHaveURL(/\/loans\/[0-9a-f-]{36}\?submitted=1$/);
    const loanId = /\/loans\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
    const db = serviceClient();
    const { data: loan } = await db
      .from("loans")
      .select("status, principal_cents, interest_cents, purpose")
      .eq("id", loanId)
      .single();
    expect(loan).toEqual({
      status: "pending_approval",
      principal_cents: 100000,
      interest_cents: 20000,
      purpose: "Market stock",
    });
    const { data: pledges } = await db
      .from("loan_collaterals")
      .select("status, collaterals(description)")
      .eq("loan_id", loanId);
    expect(pledges).toEqual([{ status: "pledged", collaterals: { description: "Honda EU22i generator" } }]);
    const { data: guarantors } = await db
      .from("guarantors")
      .select("full_name, doc_path")
      .eq("loan_id", loanId);
    expect(guarantors?.[0]?.full_name).toBe("Joseph Kollie");
    expect(guarantors?.[0]?.doc_path).toMatch(/\.pdf$/);
    const { data: request } = await db
      .from("approval_requests")
      .select("required_role")
      .eq("entity_id", loanId)
      .single();
    expect(request?.required_role).toBe("manager");
  });

  test("a manager finds the customer, sees CEO routing above the limit and saves a draft", async ({
    page,
  }) => {
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/loans/new");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Choose the customer first.")).toBeVisible();
    await fillExactly(page.getByLabel("Find the customer"), fields.last_name);
    await page.getByRole("button", { name: new RegExp(fields.last_name) }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await fillExactly(page.getByLabel("Amount to lend ($)"), "2500");
    await expect(page.getByText("Above $2,000.00: the CEO approves this loan.")).toBeVisible();
    await expect(page.getByLabel("Loan officer")).toHaveValue(/[0-9a-f-]{36}/);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Add a new item" }).click();
    await fillExactly(page.getByLabel("Description"), "Land deed D-4410");
    await page.getByLabel("Type").selectOption("land_document");
    await fillExactly(page.getByLabel("Estimated value ($)"), "5500");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Save as draft" }).click();

    await expect(page).toHaveURL(/\/loans\/[0-9a-f-]{36}\?saved=1$/);
    const loanId = /\/loans\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
    const { data: loan } = await serviceClient()
      .from("loans")
      .select("status, customer_id")
      .eq("id", loanId)
      .single();
    expect(loan).toEqual({ status: "draft", customer_id: customer.id });
  });
});
