import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { fundCash, serviceClient } from "./service";

// A 1x1 PNG for the receipt upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("expenses and payees (SPEC 7.6, 9; FR-22)", () => {
  test("the accountant pays a small expense at once; a large one waits for a manager", async ({
    page,
  }, testInfo) => {
    const tag = `${randomInt(100000, 999999)}`;
    await fundCash("1010-BR2", 100000);
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/expenses");
    const form = page.getByRole("region", { name: "New expense" });
    await form.getByLabel("Expense account").selectOption("5900");
    await form.getByLabel("Amount ($)").fill("45.00");
    await form.getByLabel("Branch").selectOption({ label: "Branch 2" });
    await form.getByLabel("Description").fill(`Office supplies ${tag}`);
    await form.getByLabel("Paid from").selectOption("1010-BR2");
    await form
      .getByLabel("Receipt (optional)")
      .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
    await form.getByRole("button", { name: "Save expense" }).click();
    await expect(form.getByText(/^EXP-BR2-\d{6} saved and posted\.$/)).toBeVisible();
    const { data: small } = await serviceClient()
      .from("expenses")
      .select("status, receipt_attachment_id, journal_id")
      .eq("description", `Office supplies ${tag}`)
      .single();
    expect(small?.status).toBe("paid");
    expect(small?.receipt_attachment_id).not.toBeNull();
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);

    await form.getByLabel("Expense account").selectOption("5040");
    await form.getByLabel("Amount ($)").fill("240.00");
    await form.getByLabel("Description").fill(`Court filing fee ${tag}`);
    await form.getByLabel("Paid from").selectOption("1010-BR2");
    await form.getByRole("button", { name: "Save expense" }).click();
    await expect(form.getByText(/waits for a manager’s approval/)).toBeVisible();
    await page.goto("/expenses?tab=pending_approval");
    await expect(page.getByRole("cell", { name: `Court filing fee ${tag}` })).toBeVisible();

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/approvals");
    const card = page.getByRole("article").filter({ hasText: `Court filing fee ${tag}` });
    await expect(card.getByText("5040 · Legal and Recovery Costs")).toBeVisible();
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveCount(0);
    const { data: big } = await serviceClient()
      .from("expenses")
      .select("status")
      .eq("description", `Court filing fee ${tag}`)
      .single();
    expect(big?.status).toBe("paid");
  });

  test("an expense on credit is owed to the payee until it is settled", async ({ page }) => {
    const name = `Kpelle Stationers ${randomInt(100000, 999999)}`;
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/payees");
    const newPayee = page.getByRole("region", { name: "New payee" });
    await newPayee.getByLabel("Name").fill(name);
    await newPayee.getByLabel("Phone (optional)").fill("0770 100 200");
    await newPayee.getByRole("button", { name: "Save payee" }).click();
    await expect(newPayee.getByText("Payee saved.")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("$0.00");
    await expectNoSeriousA11yIssues(page);

    await page.goto("/expenses");
    const form = page.getByRole("region", { name: "New expense" });
    await form.getByLabel("Expense account").selectOption("5020");
    await form.getByLabel("Amount ($)").fill("80.00");
    await form.getByLabel("Branch").selectOption({ label: "Branch 2" });
    await form.getByLabel("Description").fill(`Internet for ${name}`);
    await form.getByLabel("On credit (pay the payee later)").check();
    await form.getByLabel("Payee", { exact: true }).selectOption({ label: name });
    await form.getByRole("button", { name: "Save expense" }).click();
    await expect(form.getByText(/saved and posted/)).toBeVisible();

    await page.goto("/payees");
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("$80.00");
    await page.goto("/expenses?tab=approved");
    const row = page.getByRole("row").filter({ hasText: `Internet for ${name}` });
    await row.getByRole("combobox").selectOption("1020");
    await row.getByRole("button", { name: "Pay payee" }).click();
    await expect(page.getByRole("row").filter({ hasText: `Internet for ${name}` })).toHaveCount(0);
    await page.goto("/payees");
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("$0.00");
  });
});
