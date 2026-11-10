import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, serviceClient, userClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Mohammed",
    last_name: `Recover${n}`,
    phone: `0998 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-R${n}`,
  };
}

function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

test.describe("recovery and write-off (SPEC 5.7, 5.8; mock-up 13; FR-17, FR-19)", () => {
  test("case, court step, collateral sale with preview, write-off approved by the CEO", async ({
    page,
  }, testInfo) => {
    const fields = person();
    const name = `${fields.first_name} ${fields.last_name}`;
    const loan = await activeTestLoan(fields, 50000); // owes $600.00
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    // Setup only: the loan fell due 31 days ago, so the daily job flags it for recovery. (Its payout
    // is dated today, so no penalty base existed on the earlier charge dates; penalties are covered
    // by the database tests.)
    ownerSql(`update public.loans set due_date = '${shift(String(today), -31)}' where id = '${loan.id}'`);
    expect((await manager.rpc("run_daily_accruals", {})).error).toBeNull();

    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByRole("region", { name: "Outstanding" }).getByText("$600.00")).toBeVisible();
    await page.getByRole("button", { name: "Open recovery case" }).click();
    await page
      .getByRole("dialog", { name: "Open a recovery case" })
      .getByRole("button", { name: "Open case" })
      .click();
    await expect(page).toHaveURL(/\/recovery\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/Case RC-\d{6}/)).toBeVisible();
    await expect(page.getByRole("region", { name: "What is owed" }).getByText("0 of 4")).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);

    await page.getByRole("button", { name: "Record court step" }).click();
    const step = page.getByRole("dialog", { name: "Record the next step" });
    await expect(step.getByLabel("Step")).toHaveValue("notice_sent");
    await step.getByLabel("What was done").fill("Demand notice delivered by hand");
    await step.getByRole("button", { name: "Save step" }).click();
    await expect(
      page.getByRole("region", { name: "Stages" }).getByText(/Demand notice delivered by hand/),
    ).toBeVisible();

    // Sale preview from the database, then the sale (T-14 style: a shortfall stays on the loan).
    const sale = page.getByRole("region", { name: "Sell collateral" });
    await fillExactly(sale.getByLabel("Sale price ($)"), "500.00");
    await expect(sale.getByText("Shortfall of $100.00 stays on the loan.", { exact: false })).toBeVisible();
    await expect(sale.getByText("$400.00")).toBeVisible(); // principal after interest
    await sale.getByLabel("Buyer's name").fill("Moses Doe");
    await sale.getByRole("button", { name: "Record sale" }).click();
    await sale.getByRole("button", { name: "Yes, record sale" }).click();
    await expect(
      page.getByRole("region", { name: "What is owed" }).getByText("$100.00").first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Request write-off" }).click();
    const writeOff = page.getByRole("dialog", { name: "Ask the CEO to write off this loan" });
    await writeOff.getByLabel("Reason").fill("Sale did not cover the balance");
    await writeOff.getByRole("button", { name: "Send to the CEO" }).click();
    await expect(page.getByText("A write-off is waiting for the CEO.")).toBeVisible();

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("ceo"));
    await page.goto("/approvals");
    const card = page.getByRole("article", { name: `Write off ${name}, ${loan.loanNo}, $100.00` });
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card.getByText("Enter the board reference to approve a write-off.")).toBeVisible();
    await card.getByRole("textbox").fill("Board minute 2026/03-4");
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);

    const { data: after } = await serviceClient().from("loans").select("status").eq("id", loan.id).single();
    expect(after?.status).toBe("written_off");
  });
});
