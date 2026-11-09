import { randomInt } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { fixtureUser } from "../e2e/fixtures";
import { fillExactly, signInAs } from "../e2e/helpers";
import { fundCash, ownerSql, serviceClient, userClient } from "../e2e/service";

/*
 * SPEC 12.3 end-to-end smoke: one loan from application to collateral sale, through the screens,
 * with the business clock moved forward the way the daily job would see it.
 */
function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}
function setClock(day: string | null, time = "09:00") {
  ownerSql(
    day === null
      ? `update public.settings set value = 'null' where key = 'clock.override_at'`
      : `update public.settings set value = '{"at": "${day}T${time}:00Z", "frozen": true}' where key = 'clock.override_at'`,
  );
}
async function switchTo(page: Page, key: Parameters<typeof fixtureUser>[0]) {
  await page.context().clearCookies();
  await signInAs(page, fixtureUser(key));
}

test.afterAll(() => setClock(null));

test("SPEC 12.3: apply, approve, pay out, repay, overdue, recovery sale, reports", async ({ page }) => {
  const realToday = new Date().toISOString().slice(0, 10);
  const start = shift(realToday, -70);
  setClock(start);
  await fundCash("1010-BR2", 100000);
  const n = randomInt(100000, 999999).toString();
  const lastName = `Smoke${n}`;

  // 1. The officer, on a phone, registers the customer and applies with collateral.
  await signInAs(page, fixtureUser("loan_officer"));
  await page.goto("/customers/new");
  await fillExactly(page.getByLabel("First name"), "Fatu");
  await fillExactly(page.getByLabel("Last name"), lastName);
  await page.getByLabel("ID type").selectOption("national_id");
  await fillExactly(page.getByLabel("ID number"), `SMOKE-${n}`);
  await fillExactly(page.getByLabel("Phone", { exact: true }), `0996 ${n.slice(0, 3)} ${n.slice(3)}`);
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
  await page.getByRole("link", { name: "New loan" }).first().click();
  await expect(page.getByRole("heading", { name: "Step 2 of 5: Amount and term" })).toBeVisible();
  await fillExactly(page.getByLabel("Amount to lend ($)"), "300");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Add a new item" }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("vehicle");
  await fillExactly(page.getByLabel("Description"), "Motorbike");
  await fillExactly(page.getByLabel("Estimated value ($)"), "900");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page).toHaveURL(/\/loans\/[0-9a-f-]{36}\?submitted=1$/);
  const loanId = /\/loans\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  const { data: loan } = await serviceClient().from("loans").select("loan_no").eq("id", loanId).single();
  const loanNo = loan?.loan_no ?? "";

  // 2. The manager approves from the inbox; the cashier pays out; the loan is active with a due date.
  await switchTo(page, "manager");
  await page.goto("/approvals");
  await page
    .getByRole("article")
    .filter({ hasText: loanNo })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(page.getByRole("article").filter({ hasText: loanNo })).toHaveCount(0);
  await switchTo(page, "cashier");
  await page.goto(`/loans/${loanId}`);
  await page.getByLabel("Paid out by").selectOption("cash");
  await page.getByRole("button", { name: "Pay out" }).click();
  await page.getByRole("button", { name: "Yes, pay out" }).click();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  const { data: paid } = await serviceClient()
    .from("loans")
    .select("status, due_date")
    .eq("id", loanId)
    .single();
  expect(paid?.status).toBe("active");
  const due = String(paid?.due_date);
  const [y, m, d] = due.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  await expect(
    page
      .getByRole("main")
      .getByText(`${d} ${months[Number(m) - 1]} ${y}`)
      .first(),
  ).toBeVisible();

  // 3. A partial payment; the receipt PDF opens; the QR page shows the receipt.
  await page.getByRole("link", { name: "Receive payment" }).click();
  await fillExactly(page.getByLabel("Amount (USD)"), "100.00");
  await page.getByRole("button", { name: "Receive payment" }).click();
  await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}/);
  const pdfHref = (await page.getByRole("link", { name: "PDF" }).getAttribute("href")) ?? "";
  const pdf = await page.request.get(pdfHref);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const paymentId = /\/receipts\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  const { data: receipt } = await serviceClient()
    .from("issued_documents")
    .select("token, number")
    .eq("kind", "receipt")
    .eq("entity_id", paymentId)
    .single();
  const browser = page.context().browser();
  if (browser === null) throw new Error("no browser");
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const verify = await visitor.newPage();
  await verify.goto(`/verify/${receipt?.token ?? ""}`);
  await expect(verify.getByRole("heading", { name: "Payment receipt" })).toBeVisible();
  await expect(verify.getByText(receipt?.number ?? "")).toBeVisible();
  await expect(verify.getByText("$100.00")).toBeVisible();
  await visitor.close();

  // 4. Day 8 after the due date: overdue, one penalty on the statement.
  const manager = await userClient(fixtureUser("manager"));
  setClock(shift(due, 7), "01:00");
  expect((await manager.rpc("run_daily_accruals", {})).error).toBeNull();
  await switchTo(page, "manager");
  await page.goto(`/loans/${loanId}`);
  await expect(page.getByText("7 days overdue").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Activity", exact: true })).toContainText("Penalty, week 1");
  const { data: statement } = await manager.rpc("loan_statement", { p_loan_id: loanId });
  const lines = ((statement as { lines?: Array<{ source_type: string }> } | null)?.lines ?? []).filter(
    (line) => line.source_type === "penalty",
  );
  expect(lines).toHaveLength(1);
  expect((await page.request.get(`/api/pdf/statement/${loanId}`)).headers()["content-type"]).toBe(
    "application/pdf",
  );

  // 5. After day 30 the manager opens recovery and records the sale; the loan closes, the item is sold.
  setClock(shift(due, 31), "01:00");
  expect((await manager.rpc("run_daily_accruals", {})).error).toBeNull();
  setClock(shift(due, 31), "10:00");
  await page.goto(`/loans/${loanId}`);
  await page.getByRole("button", { name: "Open recovery case" }).click();
  await page
    .getByRole("dialog", { name: "Open a recovery case" })
    .getByRole("button", { name: "Open case" })
    .click();
  await expect(page).toHaveURL(/\/recovery\/[0-9a-f-]{36}$/);
  const sale = page.getByRole("region", { name: "Sell collateral" });
  await fillExactly(sale.getByLabel("Sale price ($)"), "900.00");
  await sale.getByLabel("Buyer's name").fill("Moses Doe");
  await sale.getByRole("button", { name: "Record sale" }).click();
  await sale.getByRole("button", { name: "Yes, record sale" }).click();
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();
  const { data: closed } = await serviceClient().from("loans").select("status").eq("id", loanId).single();
  expect(closed?.status).toBe("closed");
  const { data: pledge } = await serviceClient()
    .from("loan_collaterals")
    .select("collateral_id")
    .eq("loan_id", loanId)
    .single();
  const { data: item } = await serviceClient()
    .from("collaterals")
    .select("status")
    .eq("id", String(pledge?.collateral_id))
    .single();
  expect(item?.status).toBe("sold");

  // 6. Reports: the trial balance balances; profit and loss shows interest and penalty income.
  await switchTo(page, "accountant");
  await page.goto("/reports/trial-balance");
  await expect(page.getByRole("status").filter({ hasText: "Balanced: debits equal credits" })).toBeVisible();
  await page.goto(`/reports/profit-loss?from=${start}&to=${shift(due, 31)}`);
  const income = page.getByRole("region", { name: "Income", exact: true });
  await expect(income).toContainText("4000 · Interest Income");
  await expect(income).toContainText("4010 · Penalty Income");
});
