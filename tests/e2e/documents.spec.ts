import { randomInt } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { activeTestLoan, ownerSql, serviceClient, userClient } from "./service";

function person(first: string, prefix: string) {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: first,
    last_name: `Docs${n}`,
    phone: `0996 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-${prefix}${n}`,
  };
}

/** The masked name verify_document shows: first letter of each word, the rest as stars. */
function masked(name: string): string {
  return name
    .split(" ")
    .map((word) => word.slice(0, 1) + "*".repeat(word.length - 1))
    .join(" ");
}

function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

async function expectPdf(request: APIRequestContext, href: string): Promise<void> {
  const response = await request.get(href);
  expect(response.status(), href).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
}

async function latestDocument(kind: string, entityId: string) {
  const { data, error } = await serviceClient()
    .from("issued_documents")
    .select("number, token, amount_cents")
    .eq("kind", kind)
    .eq("entity_id", entityId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .single();
  if (error !== null) throw error;
  return data;
}

/** Opens /verify/<token> in a fresh, signed-out browser context. */
async function openVerify(page: Page, token: string): Promise<Page> {
  const context = await page
    .context()
    .browser()
    ?.newContext({ viewport: page.viewportSize() ?? undefined });
  if (context === undefined) throw new Error("no browser");
  const visitor = await context.newPage();
  await visitor.goto(`/verify/${token}`);
  return visitor;
}

test.describe("statements, notices and QR verification (SPEC 10.1, 9; FR-14, FR-25)", () => {
  test("statement from the loan and the customer; the QR page confirms it without signing in", async ({
    page,
  }, testInfo) => {
    const fields = person("Mariama", "S");
    const name = `${fields.first_name} ${fields.last_name}`;
    const loan = await activeTestLoan(fields, 50000); // owes $600.00

    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/loans/${loan.id}`);
    const link = page.getByRole("link", { name: "Statement of account (PDF)" });
    await expect(link).toHaveAttribute("href", `/api/pdf/statement/${loan.id}`);
    await expect(page.getByRole("link", { name: "Demand notice (PDF)" })).toHaveCount(0);
    await expectPdf(page.request, `/api/pdf/statement/${loan.id}`);
    const first = await latestDocument("statement", loan.id);
    expect(first.number).toMatch(/^STM-\d{6}$/);
    expect(first.amount_cents).toBe(60000);

    await page.goto(`/customers/${loan.customerId}`);
    await expect(page.getByRole("link", { name: "Statement (PDF)" })).toHaveAttribute(
      "href",
      `/api/pdf/statement/${loan.customerId}`,
    );
    await expectPdf(page.request, `/api/pdf/statement/${loan.customerId}`);
    expect((await latestDocument("statement", loan.customerId)).amount_cents).toBe(60000);

    const visitor = await openVerify(page, first.token);
    await expect(visitor.getByRole("status")).toHaveText("Genuine document: issued by us and on record.");
    await expect(visitor.getByRole("heading", { name: "Statement of account" })).toBeVisible();
    await expect(visitor.getByText(first.number)).toBeVisible();
    await expect(visitor.getByText("$600.00")).toBeVisible();
    await expect(visitor.getByText(masked(name))).toBeVisible();
    await expect(visitor.getByText(fields.phone)).toHaveCount(0);
    await expectNoSeriousA11yIssues(visitor);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(visitor);

    await visitor.goto("/verify/not-a-real-token-at-all-000");
    await expect(visitor.getByRole("heading", { name: "Document not found" })).toBeVisible();
    await visitor.context().close();
  });

  test("a demand notice for an overdue loan, from the loan page and the recovery case", async ({ page }) => {
    const loan = await activeTestLoan(person("Joseph", "N"), 50000);
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    // Setup only: the loan fell due 31 days ago, so the daily job marks it overdue and eligible.
    ownerSql(`update public.loans set due_date = '${shift(String(today), -31)}' where id = '${loan.id}'`);
    expect((await manager.rpc("run_daily_accruals", {})).error).toBeNull();

    const cashier = await userClient(fixtureUser("cashier"));
    const refused = await cashier.rpc("issue_document", { p_kind: "demand_notice", p_entity_id: loan.id });
    expect(refused.error?.message).toMatch(/^FORBIDDEN/);

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByRole("link", { name: "Demand notice (PDF)" })).toHaveAttribute(
      "href",
      `/api/pdf/demand_notice/${loan.id}`,
    );
    await expectPdf(page.request, `/api/pdf/demand_notice/${loan.id}`);
    const notice = await latestDocument("demand_notice", loan.id);
    expect(notice.number).toMatch(/^DN-\d{6}$/);
    expect(notice.amount_cents).toBe(60000);

    const { error: openError } = await manager.rpc("open_recovery_case", { p_loan_id: loan.id, p_note: "" });
    expect(openError).toBeNull();
    const { data: recoveryCase } = await serviceClient()
      .from("recovery_cases")
      .select("id")
      .eq("loan_id", loan.id)
      .single();
    await page.context().clearCookies();
    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/recovery/${recoveryCase?.id}`);
    await expect(page.getByRole("link", { name: "Demand notice (PDF)" })).toHaveAttribute(
      "href",
      `/api/pdf/demand_notice/${loan.id}`,
    );
  });

  test("collateral receipt while held, release letter once returned", async ({ page }) => {
    const fields = person("Esther", "K");
    const loan = await activeTestLoan(fields, 30000); // owes $360.00
    const { data: pledge } = await serviceClient()
      .from("loan_collaterals")
      .select("collateral_id")
      .eq("loan_id", loan.id)
      .single();
    const itemId = String(pledge?.collateral_id);

    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/collateral/${itemId}`);
    const printouts = page.getByRole("region", { name: "Printouts" });
    await expect(printouts.getByRole("link", { name: "Collateral receipt (PDF)" })).toBeVisible();
    await expect(printouts.getByRole("link", { name: "Release letter (PDF)" })).toHaveCount(0);
    await expectPdf(page.request, `/api/pdf/collateral_receipt/${itemId}`);
    await expectPdf(page.request, `/api/pdf/collateral_receipt/${itemId}`);
    const { data: receipts } = await serviceClient()
      .from("issued_documents")
      .select("number")
      .eq("kind", "collateral_receipt")
      .eq("entity_id", itemId);
    expect(receipts).toHaveLength(1); // a reprint keeps its number
    expect(receipts?.[0]?.number).toMatch(/^CR-COL-/);
    expect((await page.request.get(`/api/pdf/collateral_release/${itemId}`)).status()).toBe(409);

    const cashier = await userClient(fixtureUser("cashier"));
    const { error: payError } = await cashier.rpc("receive_payment", {
      p_loan_id: loan.id,
      p_amount_cents: 36000,
      p_method: "cash",
      p_reference: "",
      p_received_on: (await cashier.rpc("business_today")).data ?? "",
      p_idempotency_key: `e2e-docs-${randomInt(1_000_000)}`,
    });
    expect(payError).toBeNull();
    const { data: payment } = await serviceClient()
      .from("payments")
      .select("id")
      .eq("loan_id", loan.id)
      .single();
    await expectPdf(page.request, `/api/pdf/receipt/${payment?.id}`);
    const visitor = await openVerify(page, (await latestDocument("receipt", String(payment?.id))).token);
    await expect(visitor.getByRole("heading", { name: "Payment receipt" })).toBeVisible();
    await expect(visitor.getByText("$360.00")).toBeVisible();
    await visitor.context().close();
    const { error: releaseError } = await cashier.rpc("release_collateral", {
      p_collateral_id: itemId,
      p_note: "Collected by the owner",
      p_witness_name: `${fields.first_name} ${fields.last_name}`,
    });
    expect(releaseError).toBeNull();

    await page.reload();
    await expect(printouts.getByRole("link", { name: "Release letter (PDF)" })).toHaveAttribute(
      "href",
      `/api/pdf/collateral_release/${itemId}`,
    );
    await expectPdf(page.request, `/api/pdf/collateral_release/${itemId}`);
    expect((await latestDocument("collateral_release", itemId)).number).toMatch(/^RL-COL-/);
    await expectNoSeriousA11yIssues(page);
  });
});
