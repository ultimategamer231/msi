import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { activeTestLoan, serviceClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Musu",
    last_name: `Pay${n}`,
    phone: `0993 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-P${n}`,
  };
}

test.describe("receive payment and the payments list (SPEC 9; mock-up 03; FR-10, FR-20)", () => {
  test("the cashier takes a mobile money payment with the allocation preview (R2, T-11)", async ({
    page,
  }, testInfo) => {
    // $1,000 lent at 20% for a month: owes $1,200.00.
    const fields = person();
    const loan = await activeTestLoan(fields, 100000);

    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/loans/${loan.id}`);
    await page.getByRole("link", { name: "Receive payment" }).click();
    await expect(page).toHaveURL(new RegExp(`/payments/new\\?loan=${loan.id}$`));
    await expect(page.getByRole("heading", { name: "Receive payment", level: 1 })).toBeVisible();
    const owes = page.getByRole("region", { name: `${fields.first_name} ${fields.last_name}` });
    await expect(owes.getByText("$1,200.00", { exact: true })).toBeVisible();

    await fillExactly(page.getByLabel("Amount (USD)"), "500.00");
    const preview = page.getByRole("region", { name: "Allocation preview" });
    await expect(preview.getByText("$700.00")).toBeVisible();
    await expect(preview.getByText("$200.00")).toBeVisible(); // interest first (no penalty yet)
    await expect(preview.getByText("$300.00")).toBeVisible(); // then the amount lent

    await page.getByText("Mobile money", { exact: true }).click();
    await page.getByRole("button", { name: "Receive payment" }).click();
    await expect(page.getByText("Enter the transaction reference (at least 4 characters).")).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);

    const reference = `OM-${randomInt(1000000, 9999999)}`;
    await page.getByLabel("Transaction reference (required)").fill(reference);
    await page.getByRole("button", { name: "Receive payment" }).click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);

    const { data: payment } = await serviceClient()
      .from("payments")
      .select("receipt_no, amount_cents, method, reference, status")
      .eq("loan_id", loan.id)
      .single();
    expect(payment).toMatchObject({
      amount_cents: 50000,
      method: "mobile_money",
      reference,
      status: "posted",
    });
    expect(payment?.receipt_no).toMatch(/^RCT-BR2-\d{6}$/);
  });

  test("an overpayment is flagged before saving and refused (T-10)", async ({ page }) => {
    const loan = await activeTestLoan(person(), 50000);
    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/payments/new?loan=${loan.id}`);
    await fillExactly(page.getByLabel("Amount (USD)"), "600.01");
    await expect(page.getByText("This is more than the $600.00 owed. Enter $600.00 or less.")).toBeVisible();
    await page.getByRole("button", { name: "Receive payment" }).click();
    await expect(page.getByText("The amount is more than what is owed.")).toBeVisible();
    const { count } = await serviceClient()
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("loan_id", loan.id);
    expect(count).toBe(0);
  });

  test("the list finds a receipt and the cashier requests a void with a reason (FR-20)", async ({ page }) => {
    const loan = await activeTestLoan(person(), 40000);
    const cashier = fixtureUser("cashier");
    await signInAs(page, cashier);
    await page.goto(`/payments/new?loan=${loan.id}`);
    await fillExactly(page.getByLabel("Amount (USD)"), "100.00");
    await page.getByRole("button", { name: "Receive payment" }).click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
    const { data: payment } = await serviceClient()
      .from("payments")
      .select("id, receipt_no")
      .eq("loan_id", loan.id)
      .single();
    if (payment === null) throw new Error("payment missing");

    await page.goto(`/payments?q=${payment.receipt_no}`);
    await expect(page.getByText(loan.loanNo).filter({ visible: true }).first()).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("button", { name: `Request void of ${payment.receipt_no}` }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(dialog.getByText("Give the reason.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Entered on the wrong loan");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    // The row now shows the request; the payment stays posted until another manager approves.
    await expect(page.getByText("Void requested", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Request void of ${payment.receipt_no}` }).filter({ visible: true }),
    ).toHaveCount(0);

    const { data: request } = await serviceClient()
      .from("approval_requests")
      .select("status, reason")
      .eq("type", "payment_void")
      .eq("entity_id", payment.id)
      .single();
    expect(request).toMatchObject({ status: "pending", reason: "Entered on the wrong loan" });
  });
});
