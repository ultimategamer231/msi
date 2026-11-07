import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, serviceClient, userClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Joseph",
    last_name: `Field${n}`,
    phone: `0994 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-F${n}`,
  };
}

/* A paid-out loan of the test officer that falls due today (setup only: the due date is moved). */
async function loanDueToday(principalCents: number) {
  const fields = person();
  const loan = await activeTestLoan(fields, principalCents);
  const officer = await userClient(fixtureUser("loan_officer"));
  const { data: user } = await officer.auth.getUser();
  ownerSql(
    `update public.loans set due_date = public.business_today(), officer_id = '${user.user?.id ?? ""}' where id = '${loan.id}'`,
  );
  return { ...loan, name: `${fields.first_name} ${fields.last_name}` };
}

test.describe("field collection and handover (SPEC 9; mock-ups 01, 02; R3, R3b; T-28, T-36)", () => {
  test("the officer collects cash in the field and the cashier confirms the handover", async ({
    page,
  }, testInfo) => {
    const loan = await loanDueToday(60000); // owes $720.00

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/field");
    const card = page.getByRole("article", { name: loan.name });
    await expect(card.getByText("Due today", { exact: true })).toBeVisible();
    await expect(card.getByText("$720.00")).toBeVisible();
    await expect(card.getByRole("link", { name: `Call ${loan.name}` })).toHaveAttribute("href", /^tel:/);
    const collect = card.getByRole("link", { name: `Collect from ${loan.name}` });
    expect((await collect.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);

    await collect.click();
    await expect(page).toHaveURL(new RegExp(`/field/collect/${loan.id}$`));
    await expect(page.getByRole("heading", { name: "Collect payment", level: 1 })).toBeVisible();
    await fillExactly(page.getByLabel("Amount received (USD)"), "350.00");
    const preview = page.getByRole("region", { name: "Where this payment goes" });
    await expect(preview.getByText("$370.00")).toBeVisible(); // still owed after this
    await expect(page.getByText(/The borrower gets a receipt now/)).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("button", { name: "Save payment and issue receipt" }).click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);

    const { data: payment } = await serviceClient()
      .from("payments")
      .select("id, receipt_no, remittance_status, collected_in_field")
      .eq("loan_id", loan.id)
      .single();
    expect(payment).toMatchObject({ remittance_status: "pending", collected_in_field: true });
    const receiptNo = payment?.receipt_no ?? "";
    await page.goto("/field");
    await expect(page.getByRole("link", { name: receiptNo })).toBeVisible();

    // The cashier counts the cash: a wrong total posts nothing (T-36), the right one confirms (T-28).
    await page.context().clearCookies();
    await signInAs(page, fixtureUser("cashier"));
    await page.goto("/remittance");
    await expect(page.getByRole("heading", { name: "Field cash", level: 1 })).toBeVisible();
    await page.getByRole("checkbox", { name: new RegExp(receiptNo) }).check();
    await expectNoSeriousA11yIssues(page);
    await page.getByLabel("Counted cash (USD)").fill("340.00");
    await page.getByRole("button", { name: "Confirm handover" }).click();
    await expect(page.getByText("The counted total does not match the selected collections.")).toBeVisible();
    await page.getByLabel("Counted cash (USD)").fill("350.00");
    await page.getByRole("button", { name: "Confirm handover" }).click();
    await expect(page.getByText(/Handover of \$350\.00 confirmed/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: new RegExp(receiptNo) })).toHaveCount(0);

    const { data: after } = await serviceClient()
      .from("payments")
      .select("remittance_status")
      .eq("id", payment?.id ?? "")
      .single();
    expect(after?.remittance_status).toBe("confirmed");
  });

  test("a cashier does not see the field screen; an officer does not see field cash to confirm", async ({
    page,
  }) => {
    await signInAs(page, fixtureUser("cashier"));
    await page.goto("/field");
    await expect(page).not.toHaveURL(/\/field$/);
    await page.context().clearCookies();
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/remittance");
    await expect(page).not.toHaveURL(/\/remittance$/);
  });
});
