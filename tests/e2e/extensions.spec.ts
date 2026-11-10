import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, serviceClient, userClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Joseph",
    last_name: `Extend${n}`,
    phone: `0996 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-X${n}`,
  };
}

test.describe("loan extension (SPEC 5.6; mock-up 12; FR-18; T-13)", () => {
  test("the officer asks for a month more and a manager approves it in the inbox", async ({ page }) => {
    const fields = person();
    const loan = await activeTestLoan(fields, 60000); // owes $720.00, interest 20% a month
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    // Setup only: the loan falls due today.
    ownerSql(`update public.loans set due_date = '${String(today)}' where id = '${loan.id}'`);
    const name = `${fields.first_name} ${fields.last_name}`;

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/loans/${loan.id}`);
    await page.getByRole("button", { name: "Extend loan" }).click();
    const dialog = page.getByRole("dialog", { name: "Extend this loan" });
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(dialog.getByText("Give the reason.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Shop stock delayed at port");
    await expectNoSeriousA11yIssues(page);
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText(/An extension of 1 month is waiting for approval/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Extend loan" })).toHaveCount(0);

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/approvals");
    const card = page.getByRole("article", { name: `${name}, ${loan.loanNo}, 1 more month` });
    await expect(card.getByText("Shop stock delayed at port")).toBeVisible();
    await expect(
      card.getByText(
        /^Approving adds one month of interest \(\$120\.00\)\. The borrower would owe \$840\.00, due/,
      ),
    ).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);

    const { data: after } = await serviceClient()
      .from("loans")
      .select("status, due_date_version")
      .eq("id", loan.id)
      .single();
    expect(after).toMatchObject({ status: "active", due_date_version: 2 });
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByRole("region", { name: "Outstanding" }).getByText("$840.00")).toBeVisible();
    await expect(page.getByText("Extension interest")).toBeVisible();
  });
});
