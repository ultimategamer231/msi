import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { activeTestLoan, createTestCustomer, serviceClient, userClient } from "./service";

function person(first: string) {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: first,
    last_name: `Item${n}`,
    phone: `0997 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-C${n}`,
  };
}

// A 1x1 PNG, enough for the photo upload path (the server checks the file's real type).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("collateral register (SPEC 5.9, 9; mock-ups 09, 10; FR-15, FR-16)", () => {
  test("an officer registers an item with a photo; a repeated plate is flagged", async ({
    page,
  }, testInfo) => {
    const fields = person("Mohammed");
    const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
    const plate = `E2E ${randomInt(1000, 9999)}-${testInfo.project.name === "phone-390" ? "P" : "D"}`;

    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto(`/collateral/new?customer=${customer.id}`);
    await expect(page.getByText(`${fields.first_name} ${fields.last_name}`)).toBeVisible();
    await page.getByLabel("Type").selectOption("vehicle");
    await page.getByLabel("Description").fill("Toyota Corolla 2008");
    await page.getByLabel("Plate number (optional)").fill(plate);
    await page.getByLabel("Estimated value ($)").fill("4,200.00");
    await page.getByLabel("Where it is kept").fill("Branch 2 yard");
    await page.getByLabel("Photos and documents (optional)").setInputFiles({
      name: "front.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Register item" }).click();
    await expect(page).toHaveURL(/\/collateral\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /^COL-\d{6}$/, level: 2 })).toBeVisible();
    await expect(page.getByText("Held", { exact: true })).toBeVisible();
    const log = page.getByRole("region", { name: "Custody log" });
    await expect(log.getByText("Received", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "front.png" })).toBeVisible();
    await expectNoSeriousA11yIssues(page);

    // The same plate again: a warning first, then the choice to register anyway.
    await page.goto(`/collateral/new?customer=${customer.id}`);
    await page.getByLabel("Description").fill("Same car, second entry");
    await page.getByLabel("Plate number (optional)").fill(plate.toLowerCase());
    await page.getByLabel("Estimated value ($)").fill("4,000.00");
    await page.getByLabel("Where it is kept").fill("Branch 2 yard");
    await page.getByRole("button", { name: "Register item" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /The same identifier is already on COL-\d{6}/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Register anyway" })).toBeVisible();
  });

  test("custody events and return to the owner once the loan is paid (FR-16)", async ({ page }) => {
    const fields = person("Prince");
    const loan = await activeTestLoan(fields, 30000); // pledges a Samsung TV
    const { data: pledge } = await serviceClient()
      .from("loan_collaterals")
      .select("collateral_id")
      .eq("loan_id", loan.id)
      .single();
    const itemId = pledge?.collateral_id ?? "";

    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/collateral/${itemId}`);
    await expect(
      page.getByText(`It can be returned to the owner once ${loan.loanNo} has ended.`),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Return to owner" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add custody event" }).click();
    const form = page.getByRole("form", { name: "Add custody event" });
    await expect(form.getByLabel("Event").locator("option")).toHaveText(["Moved", "Note"]);
    await form.getByLabel("New location").fill("Branch 2 safe, shelf B2");
    await form.getByLabel("Witness (optional)").fill("Grace Flomo");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved in the custody log.")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Custody log" }).getByText(/to Branch 2 safe, shelf B2$/),
    ).toBeVisible();

    // The borrower pays in full; the item can go back.
    const cashier = await userClient(fixtureUser("cashier"));
    const { error } = await cashier.rpc("receive_payment", {
      p_loan_id: loan.id,
      p_amount_cents: 36000,
      p_method: "cash",
      p_reference: "",
      p_received_on: (await cashier.rpc("business_today")).data ?? "",
      p_idempotency_key: `e2e-release-${randomInt(1_000_000)}`,
    });
    expect(error).toBeNull();
    await page.reload();
    await page.getByRole("button", { name: "Return to owner" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Return this item to its owner" });
    await expect(dialog.getByLabel("Collected by")).toHaveValue(`${fields.first_name} ${fields.last_name}`);
    await dialog.getByRole("button", { name: "Confirm return" }).click();
    await expect(page.getByText("Released", { exact: true }).first()).toBeVisible();

    await page.goto(`/collateral?tab=released&q=${encodeURIComponent(fields.last_name)}`);
    await expect(page.getByText("Samsung TV 43 inch").filter({ visible: true })).toBeVisible();
    await expectNoSeriousA11yIssues(page);
  });
});
