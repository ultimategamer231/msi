import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, fillExactly, signInAs } from "./helpers";
import { latestAudit, serviceClient } from "./service";

test.describe("loan products (SPEC 7.1; FR-06)", () => {
  test("the admin adds a product and changes its rate; rates are stored as basis points", async ({
    page,
  }) => {
    const name = `Test product ${randomInt(100000, 999999)}`;
    await signInAs(page, fixtureUser("admin"));
    await page.goto("/settings?tab=products");
    const panel = page.getByRole("region", { name: "Loan products" });
    await expect(panel.getByRole("cell", { name: "Standard 1-month", exact: true })).toBeVisible();
    await expect(panel.getByRole("row").filter({ hasText: "Standard 1-month" })).toContainText(
      "20% flat per month",
    );

    await panel.getByRole("button", { name: "Add product" }).click();
    await fillExactly(panel.getByLabel("Name"), name);
    await fillExactly(panel.getByLabel("Interest per month (%)"), "12.5");
    await fillExactly(panel.getByLabel("Usual term (months)"), "4");
    await fillExactly(panel.getByLabel("Longest term (months)"), "3");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByText("The usual term cannot be longer than the longest term.")).toBeVisible();
    await fillExactly(panel.getByLabel("Usual term (months)"), "2");
    await fillExactly(panel.getByLabel("Penalty rate (%)"), "20.555");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByText(/at most two decimals/)).toBeVisible();
    await fillExactly(panel.getByLabel("Penalty rate (%)"), "10");
    await panel.getByLabel("Penalty is charged on").selectOption("original_due");
    await expectNoSeriousA11yIssues(page);
    await panel.getByRole("button", { name: "Save" }).click();

    const row = panel.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("12.5% flat per month");
    await expect(row).toContainText("2 months (up to 3)");
    const { data } = await serviceClient()
      .from("loan_products")
      .select("id, interest_rate_bps, penalty_rate_bps, penalty_base")
      .eq("name", name)
      .single();
    expect(data).toMatchObject({
      interest_rate_bps: 1250,
      penalty_rate_bps: 1000,
      penalty_base: "original_due",
    });

    await row.getByRole("button", { name: /Edit/ }).click();
    await fillExactly(panel.getByLabel("Interest per month (%)"), "15");
    await panel.getByLabel("Offered for new loans").uncheck();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("15% flat per month");
    await expect(row).toContainText("Not offered");
    const [audit] = await latestAudit("loan_product.updated", data?.id ?? "");
    expect(audit?.before).toMatchObject({ interest_rate_bps: 1250, active: true });
    expect(audit?.after).toMatchObject({ interest_rate_bps: 1500, active: false });
    await expectNoHorizontalScroll(page);
  });
});
