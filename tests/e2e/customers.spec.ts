import { randomInt } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { latestAudit, serviceClient } from "./service";

// A 1x1 PNG and a minimal PDF: real file signatures, so the server-side type check accepts them.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/* Phone numbers and IDs from a test-only range, unique per run so reruns never collide. */
function uniquePerson() {
  const n = randomInt(100000, 999999).toString();
  return { phone: `0999 ${n.slice(0, 3)} ${n.slice(3)}`, idNumber: `E2E-${n}`, lastName: `Tester${n}` };
}

async function fillIndividual(page: Page, person: ReturnType<typeof uniquePerson>, firstName = "Ama") {
  await fillExactly(page.getByLabel("First name"), firstName);
  await fillExactly(page.getByLabel("Last name"), person.lastName);
  await page.getByLabel("ID type").selectOption("national_id");
  await fillExactly(page.getByLabel("ID number"), person.idNumber);
  await fillExactly(page.getByLabel("Phone", { exact: true }), person.phone);
}

/* After saving, the new profile opens with "Customer CU-000123 was created." */
async function createdCode(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}\?created=1$/);
  const notice = page.getByRole("status").filter({ hasText: /Customer CU-\d{6} was created\./ });
  await expect(notice).toBeVisible();
  return /CU-\d{6}/.exec((await notice.textContent()) ?? "")?.[0] ?? "";
}

test.describe("customers (SPEC 5.11, 9; FR-03)", () => {
  test("a loan officer registers an individual with a photo and an ID scan", async ({ page }) => {
    const person = uniquePerson();
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/customers");
    await page.getByRole("link", { name: "New customer" }).first().click();
    await expect(page.getByRole("heading", { name: "New customer", level: 1 })).toBeVisible();
    await expect(page.getByText("Branch 2 · loan officer Test Officer")).toBeVisible();

    await fillIndividual(page, person);
    await fillExactly(page.getByLabel("Occupation (optional)"), "Market trader");
    await fillExactly(page.getByRole("textbox", { name: "Name (optional)" }), "Joseph Kollie");
    await page
      .getByLabel("Customer photo")
      .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await page
      .getByLabel("ID scan")
      .setInputFiles({ name: "national-id.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByText("Chosen: national-id.pdf")).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await page.getByRole("button", { name: "Save customer" }).click();

    const code = await createdCode(page);

    const { data: customer } = await serviceClient()
      .from("customers")
      .select("id, branch_id, assigned_officer_id, photo_path, occupation, next_of_kin_name")
      .eq("code", code)
      .single();
    expect(customer?.occupation).toBe("Market trader");
    expect(customer?.next_of_kin_name).toBe("Joseph Kollie");
    expect(customer?.photo_path).toMatch(/\.png$/);
    const { data: files } = await serviceClient()
      .from("attachments")
      .select("kind, mime, file_name")
      .eq("entity_id", customer?.id ?? "")
      .order("kind");
    expect(files).toEqual([
      { kind: "id_document", mime: "application/pdf", file_name: "national-id.pdf" },
      { kind: "photo", mime: "image/png", file_name: "photo.png" },
    ]);
    const [audit] = await latestAudit("customer.created", customer?.id ?? "");
    expect(audit?.after).toMatchObject({ code, phone: person.phone });

    // The new customer is found by phone digits, ID number and name.
    for (const term of [
      person.phone.replace(/\s/g, ""),
      person.idNumber.toLowerCase(),
      `Ama ${person.lastName}`,
    ]) {
      await page.goto(`/customers?q=${encodeURIComponent(term)}`);
      await expect(page.getByRole("heading", { name: "1 customer" })).toBeVisible();
      await expect(page.getByRole("link", { name: `Ama ${person.lastName}` }).first()).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("a duplicate phone is blocked for an officer and overridden by a manager with a reason (T-32)", async ({
    page,
  }) => {
    const person = uniquePerson();
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/customers/new");
    await fillIndividual(page, person);
    await page.getByRole("button", { name: "Save customer" }).click();
    await createdCode(page);

    // Same phone written another way, different person.
    const second = uniquePerson();
    await page.goto("/customers/new");
    await fillIndividual(page, { ...second, phone: `+231 ${person.phone.slice(1)}` }, "Kofi");
    await page.getByRole("button", { name: "Save customer" }).click();
    const warning = page.getByRole("alert").filter({ hasText: "This customer may already be registered" });
    await expect(warning).toContainText(`Ama ${person.lastName}`);
    await expect(warning).toContainText("same phone number");
    await expect(warning).toContainText("ask a manager");
    await expect(page.getByRole("button", { name: "Create anyway" })).toHaveCount(0);
    await expectNoSeriousA11yIssues(page);

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/customers/new");
    await page.getByLabel("Branch", { exact: true }).selectOption({ label: "BR2 · Branch 2" });
    await fillIndividual(page, { ...second, phone: person.phone }, "Kofi");
    await page.getByRole("button", { name: "Save customer" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "This customer may already be registered" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create anyway" }).click();
    await expect(page.getByText("Required.")).toBeVisible();
    await fillExactly(page.getByLabel("Reason for creating a second record"), "Brothers sharing one phone");
    await page.getByRole("button", { name: "Create anyway" }).click();
    const code = await createdCode(page);
    const { data: created } = await serviceClient().from("customers").select("id").eq("code", code).single();
    const [audit] = await latestAudit("customer.created", created?.id ?? "");
    expect(audit?.after).toMatchObject({ duplicate_override: { reason: "Brothers sharing one phone" } });
  });

  test("a manager registers a business for a chosen branch and officer", async ({ page }) => {
    const person = uniquePerson();
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/customers/new");
    await page.getByText("Business", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
    await fillExactly(page.getByLabel("Registered business name"), `Test Trading ${person.lastName}`);
    await fillExactly(page.getByLabel("Contact person"), "J. Dolo");
    await fillExactly(page.getByLabel("Phone", { exact: true }), person.phone);
    await page.getByLabel("Branch", { exact: true }).selectOption({ label: "BR2 · Branch 2" });
    await page.getByLabel("Loan officer").selectOption({ label: "Test Officer" });
    await page.getByRole("button", { name: "Save customer" }).click();
    await createdCode(page);
    await page.goto(`/customers?q=${encodeURIComponent(`Test Trading ${person.lastName}`)}`);
    await expect(page.getByRole("heading", { name: "1 customer" })).toBeVisible();
  });

  test("required fields and file types are checked before anything is saved", async ({ page }) => {
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/customers/new");
    await page.getByRole("button", { name: "Save customer" }).click();
    await expect(page.getByText("Required.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/customers\/new$/);

    const person = uniquePerson();
    await fillIndividual(page, person);
    await page.getByLabel("ID scan").setInputFiles({
      name: "scan.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("<html>not an image</html>"),
    });
    await page.getByRole("button", { name: "Save customer" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The file was not accepted." })).toBeVisible();
    const { count } = await serviceClient()
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("id_number", person.idNumber);
    expect(count).toBe(0);
  });

  test("a cashier sees the list but cannot open the new-customer form", async ({ page }) => {
    await signInAs(page, fixtureUser("cashier"));
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "Customers", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "New customer" })).toHaveCount(0);
    await page.goto("/customers/new");
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/customers?q=no-such-customer-xyz");
    await expect(page.getByText("No customers match these filters.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });
});
