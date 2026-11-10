import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, userClient } from "./service";

function person() {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: "Esther",
    last_name: `Late${n}`,
    phone: `0995 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-A${n}`,
  };
}

function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

test.describe("penalties on the loan page (SPEC 5.5, 9; mock-up 07; FR-12)", () => {
  test("after the daily job, the loan shows the week-1 penalty and the next one", async ({ page }) => {
    const loan = await activeTestLoan(person(), 50000); // owes $600.00
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    // Setup only: the loan fell due a week ago.
    ownerSql(`update public.loans set due_date = '${shift(String(today), -7)}' where id = '${loan.id}'`);
    const { error } = await manager.rpc("run_daily_accruals", {});
    expect(error).toBeNull();

    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByText("7 days overdue", { exact: true })).toBeVisible();
    await expect(page.getByText("1 of 4 weekly charges")).toBeVisible();
    const activity = page.getByRole("region", { name: "Activity" });
    await expect(activity.getByText("Penalty, week 1 (20% of $600.00)")).toBeVisible();
    await expect(activity.getByText("+$120.00")).toBeVisible();
    // Next: 20% of the $720.00 owed now, a week later.
    await expect(page.getByText(/^Next penalty \d{2} [A-Z][a-z]{2} \d{4}: \$144\.00$/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Outstanding" }).getByText("$720.00")).toBeVisible();
    await expectNoSeriousA11yIssues(page);
  });
});
