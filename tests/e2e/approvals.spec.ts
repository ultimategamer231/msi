import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { createTestCustomer, latestAudit, serviceClient, submitTestLoan, userClient } from "./service";

/* Test-only phone range, unique per run. */
function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Mariama",
    last_name: `Approval${n}`,
    phone: `0997 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-A${n}`,
  };
}
const nextPhone = (phone: string) => `${phone.slice(0, -1)}${(Number(phone.slice(-1)) + 1) % 10}`;

test.describe("customer edits and the approvals inbox (SPEC 5.11, 9; T-29; mock-ups 08 and 12)", () => {
  test("an officer's phone change waits for a manager, who approves it from the inbox (T-29)", async ({
    page,
  }) => {
    const fields = person();
    const name = `${fields.first_name} ${fields.last_name}`;
    const newPhone = nextPhone(fields.phone);
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("link", { name: "Request edit" }).click();
    await fillExactly(page.getByLabel("Phone", { exact: true }), newPhone);
    await fillExactly(page.getByLabel(/^Reason \(optional/), "New SIM card");
    await page.getByRole("button", { name: "Send for approval" }).click();

    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}\\?requested=1$`));
    await expect(page.getByText("1 change waiting for approval.")).toBeVisible();
    await expect(
      page.getByText(`Phone number ${fields.phone} to ${newPhone}, requested by Test Officer`),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Request edit" })).toHaveCount(0);
    // T-29: nothing changes until approved.
    const { data: before } = await serviceClient()
      .from("customers")
      .select("phone")
      .eq("id", customer.id)
      .single();
    expect(before?.phone).toBe(fields.phone);

    // The officer sees the request under Mine only, and cannot decide it.
    await page.goto("/approvals");
    await expect(page.getByRole("link", { name: "Waiting" })).toHaveCount(0);
    const mine = page.getByRole("article").filter({ hasText: `${name}, phone number` });
    await expect(mine).toContainText("Waiting");
    await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/approvals");
    await expect(page.getByText(/^\d+ waiting for you$/)).toBeVisible();
    const card = page.getByRole("article").filter({ hasText: `${name}, phone number` });
    await expect(card).toContainText(`Current${fields.phone}`);
    await expect(card).toContainText(`Requested${newPhone}`);
    await expect(card).toContainText("Reason given: New SIM card");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);

    const { data: after } = await serviceClient()
      .from("customers")
      .select("phone")
      .eq("id", customer.id)
      .single();
    expect(after?.phone).toBe(newPhone);
    const [audit] = await latestAudit("customer.updated", customer.id);
    expect(audit?.before).toEqual({ phone: fields.phone });
    expect(audit?.after).toMatchObject({ phone: newPhone });

    await page.goto("/approvals?tab=approved");
    await expect(page.getByRole("article").filter({ hasText: `${name}, phone number` })).toContainText(
      "Approved by Test Manager",
    );
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText(newPhone, { exact: true })).toBeVisible();
    await expect(page.getByText("1 change waiting for approval.")).toHaveCount(0);
  });

  test("a rejection needs a reason and a confirmation, and changes nothing", async ({ page }) => {
    const fields = person();
    const name = `${fields.first_name} ${fields.last_name}`;
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    const cashier = await userClient(fixtureUser("cashier"));
    const { error } = await cashier.rpc("request_customer_edit", {
      p_customer_id: customer.id,
      p_patch: { city: "Gbarnga" },
      p_reason: "",
    });
    expect(error).toBeNull();

    await signInAs(page, fixtureUser("manager"));
    await page.goto("/approvals");
    const card = page.getByRole("article").filter({ hasText: `${name}, city or county` });
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(card.getByText("Give the reason for rejecting.")).toBeVisible();
    await fillExactly(card.getByRole("textbox"), "Customer still lives in Monrovia");
    await card.getByRole("button", { name: "Reject" }).click();
    const confirm = card.getByRole("alertdialog");
    await expect(confirm).toContainText("Reason: Customer still lives in Monrovia");
    await expectNoSeriousA11yIssues(page);
    await confirm.getByRole("button", { name: "Yes, reject" }).click();
    await expect(card).toHaveCount(0);

    const { data } = await serviceClient().from("customers").select("city").eq("id", customer.id).single();
    expect(data?.city).toBeNull();
    await page.goto("/approvals?tab=rejected");
    await expect(page.getByRole("article").filter({ hasText: `${name}, city or county` })).toContainText(
      "Customer still lives in Monrovia",
    );
  });

  test("a manager's own request is not offered to them to approve", async ({ page }) => {
    const fields = person();
    const name = `${fields.first_name} ${fields.last_name}`;
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);

    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/customers/${customer.id}`);
    await page.getByLabel("New status").selectOption("blacklisted");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText("Give the reason.")).toBeVisible();
    await fillExactly(page.getByLabel("Reason", { exact: true }), "Gave false ID details");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText("1 change waiting for approval.")).toBeVisible();
    await expect(page.getByText(/Status Active to Blacklisted/)).toBeVisible();

    await page.goto("/approvals");
    await expect(page.getByRole("article").filter({ hasText: `${name}, status` })).toHaveCount(0);
    await page.goto("/approvals?tab=mine");
    await expect(page.getByRole("article").filter({ hasText: `${name}, status` })).toContainText("Waiting");

    // The CEO decides it.
    await page.context().clearCookies();
    await signInAs(page, fixtureUser("ceo"));
    await page.goto("/approvals");
    await page
      .getByRole("article")
      .filter({ hasText: `${name}, status` })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(page.getByRole("article").filter({ hasText: `${name}, status` })).toHaveCount(0);
    const { data } = await serviceClient().from("customers").select("status").eq("id", customer.id).single();
    expect(data?.status).toBe("blacklisted");
  });

  test("an approved manual journal is posted to the ledger", async ({ page }) => {
    const memo = `Inbox journal ${randomInt(100000, 999999)}`;
    const accountant = await userClient(fixtureUser("accountant"));
    const { data: today } = await accountant.rpc("business_today");
    const { error } = await accountant.rpc("request_manual_journal", {
      p_request: {
        entry_date: today,
        memo,
        lines: [
          { account: "5010", debit_cents: 4500 },
          { account: "1010-BR2", credit_cents: 4500 },
        ],
      },
    });
    expect(error).toBeNull();

    await signInAs(page, fixtureUser("manager"));
    await page.goto("/approvals");
    const card = page.getByRole("article").filter({ hasText: memo });
    await expect(card).toContainText("$45.00");
    await expect(card).toContainText("5010 · Rent");
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);
    await page.goto("/ledger");
    await expect(page.getByText(memo).first()).toBeVisible();
  });

  test("staff add a document to a customer and see the approvals count", async ({ page }) => {
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText("No documents yet.")).toBeVisible();
    await page.getByLabel("Document", { exact: true }).selectOption("proof_of_address");
    await page.getByLabel("File", { exact: true }).setInputFiles({
      name: "utility-bill.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await page.getByRole("button", { name: "Add document" }).click();
    await expect(page.getByText("The document was added.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Proof of address" })).toBeVisible();
    await expect(page.getByText(/utility-bill\.pdf/)).toBeVisible();
    // A cashier decides nothing, so no approvals count is shown.
    await expect(page.getByText(/requests? waiting/)).toHaveCount(0);
  });

  test("loan applications: a manager approves up to the limit; above it only the CEO decides (T-18, T-19)", async ({
    page,
  }) => {
    const fields = person();
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    const small = await submitTestLoan(fixtureUser("loan_officer"), customer.id, 150000);
    const large = await submitTestLoan(fixtureUser("loan_officer"), customer.id, 250000);

    await signInAs(page, fixtureUser("manager"));
    await page.goto("/approvals");
    const card = page.getByRole("article").filter({ hasText: small.loanNo });
    await expect(card).toContainText("$1,500.00");
    await expect(card).toContainText("Total to repay$1,800.00");
    await expect(page.getByRole("article").filter({ hasText: large.loanNo })).toHaveCount(0);
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);
    const { data: approved } = await serviceClient()
      .from("loans")
      .select("status")
      .eq("id", small.id)
      .single();
    expect(approved?.status).toBe("approved");

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("ceo"));
    await page.goto("/approvals");
    const ceoCard = page.getByRole("article").filter({ hasText: large.loanNo });
    await expect(ceoCard).toContainText("Above the $2,000.00 manager limit, so it needs CEO approval.");
    await expectNoSeriousA11yIssues(page);
  });
});
