import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { createTestCustomer, fundCash, serviceClient, submitTestLoan, userClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Mariama",
    last_name: `Loan${n}`,
    phone: `0992 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-L${n}`,
  };
}

/* Registers and pledges an item through the RPCs, as the officer would in the wizard. */
async function pledge(loanId: string, customerId: string) {
  const officer = await userClient(fixtureUser("loan_officer"));
  const { data: itemId, error } = await officer.rpc("register_collateral", {
    p_item: {
      owner_customer_id: customerId,
      type: "electronics",
      description: "Honda EU22i generator",
      estimated_value_cents: 140000,
      location_note: "Branch 2 safe",
    },
  });
  if (error !== null) throw error;
  const { error: linkError } = await officer.rpc("link_collateral", {
    p_loan_id: loanId,
    p_collateral_id: itemId,
  });
  if (linkError !== null) throw linkError;
}

test.describe("loans list and detail (SPEC 9; mock-ups 06, 07, 08; FR-07, FR-08)", () => {
  test("a manager approves on the loan page and the cashier pays it out (R1)", async ({ page }) => {
    const fields = person();
    const name = `${fields.first_name} ${fields.last_name}`;
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    const loan = await submitTestLoan(fixtureUser("loan_officer"), customer.id, 100000);
    await pledge(loan.id, customer.id);
    await fundCash("1010-BR2", 100000);

    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByRole("heading", { name: loan.loanNo, level: 2 })).toBeVisible();
    await expect(page.getByText("Pending approval", { exact: true })).toBeVisible();
    await expect(page.getByText("Honda EU22i generator")).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved, not paid out", { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await page.getByLabel("Paid out by").selectOption("cash");
    await page.getByRole("button", { name: "Pay out" }).click();
    await expect(page.getByText("Pay out $1,000.00 from Branch 2 cash?")).toBeVisible();
    await page.getByRole("button", { name: "Yes, pay out" }).click();

    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    const outstanding = page.getByRole("region", { name: "Outstanding" });
    await expect(outstanding).toContainText("$1,200.00");
    const activity = page.getByRole("region", { name: "Activity", exact: true });
    await expect(activity).toContainText("Loan paid out by cash");
    await expect(activity).toContainText("+$1,000.00");
    await expect(activity).toContainText("Interest charged (20% × 1 month)");
    await expect(activity).toContainText("+$200.00");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);

    const { data } = await serviceClient()
      .from("loans")
      .select("status, disbursed_on, due_date")
      .eq("id", loan.id)
      .single();
    expect(data?.status).toBe("active");
    expect(data?.due_date).not.toBeNull();

    // The customer profile shows the loan and what is owed (mock-up 08).
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    const loans = page.getByRole("region", { name: "Loans", exact: true });
    await expect(loans.getByRole("link", { name: loan.loanNo })).toBeVisible();
    await expect(loans).toContainText("$1,200.00");
    await expect(page.getByText("Total owed")).toBeVisible();

    // The loans list finds it by number.
    await page.goto(`/loans?q=${encodeURIComponent(loan.loanNo)}`);
    await expect(page.getByRole("link", { name: loan.loanNo }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("a draft is sent by its creator; an approved loan can be cancelled with a reason", async ({
    page,
  }) => {
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    const officer = await userClient(fixtureUser("loan_officer"));
    const { data: product } = await officer
      .from("loan_products")
      .select("id")
      .eq("name", "Standard 1-month")
      .single();
    const { data: draftId } = await officer.rpc("create_loan_draft", {
      p_loan: { customer_id: customer.id, product_id: product?.id, principal_cents: 50000, term_months: 1 },
    });

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/loans/${draftId}`);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText("Pending approval", { exact: true })).toBeVisible();
    await expect(page.getByText(/Waiting for a manager's approval/)).toBeVisible();

    const manager = await userClient(fixtureUser("manager"));
    const { data: request } = await manager
      .from("approval_requests")
      .select("id")
      .eq("entity_id", draftId)
      .single();
    await manager.rpc("decide_approval", { p_id: request?.id, p_decision: "approve", p_note: "" });

    await page.reload();
    await page.getByRole("button", { name: "Cancel loan" }).click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Give the reason.")).toBeVisible();
    await fillExactly(page.getByLabel("Reason", { exact: true }), "Customer no longer needs it");
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  });

  test("the loans list shows tabs with counts and the open total", async ({ page }) => {
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/loans");
    await expect(page.getByRole("heading", { name: "Loans", level: 1 })).toBeVisible();
    for (const tab of ["All", "Active", "Due today", "Overdue", "Recovery", "Pending", "Closed"]) {
      await expect(
        page
          .getByRole("navigation", { name: "Loan status" })
          .getByRole("link", { name: new RegExp(`^${tab} \\d+$`) }),
      ).toBeVisible();
    }
    await expect(page.getByText(/open, total owed \$/)).toBeVisible();
    await page.getByRole("link", { name: /^Pending \d+$/ }).click();
    await expect(page).toHaveURL(/tab=pending/);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("the loan agreement PDF is numbered once and opens from the loan page (SPEC 10.1)", async ({
    page,
  }) => {
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    const loan = await submitTestLoan(fixtureUser("loan_officer"), customer.id, 80000);
    await pledge(loan.id, customer.id);
    const manager = await userClient(fixtureUser("manager"));
    const { data: request } = await manager
      .from("approval_requests")
      .select("id")
      .eq("entity_id", loan.id)
      .single();
    await manager.rpc("decide_approval", { p_id: request?.id, p_decision: "approve", p_note: "" });

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/loans/${loan.id}`);
    const link = page.getByRole("link", { name: "Loan agreement (PDF)" });
    await expect(link).toHaveAttribute("href", `/api/pdf/loan_agreement/${loan.id}`);
    for (let print = 0; print < 2; print += 1) {
      const response = await page.request.get(`/api/pdf/loan_agreement/${loan.id}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("application/pdf");
      expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    const { data: documents } = await serviceClient()
      .from("issued_documents")
      .select("number")
      .eq("entity_id", loan.id);
    expect(documents).toEqual([{ number: `AGR-${loan.loanNo}` }]);

    const signedOut = await page.context().browser()?.newContext();
    const anonymous = await signedOut?.request.get(
      `http://localhost:3000/api/pdf/loan_agreement/${loan.id}`,
      { maxRedirects: 0 },
    );
    expect([302, 303, 307, 401]).toContain(anonymous?.status());
    await signedOut?.close();
  });
});
