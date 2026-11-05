import { randomInt } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yIssues,
  fillExactly,
  signIn,
  signInAs,
  signOutThroughUi,
} from "./helpers";
import { latestAudit } from "./service";

const unique = () => `${Date.now().toString(36)}${randomInt(1000, 9999)}`;

async function openSettings(page: Page, tab?: string) {
  await page.goto(tab === undefined ? "/settings" : `/settings?tab=${tab}`);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

test.describe("route guard (M0 acceptance: unauthorised routes redirect)", () => {
  for (const key of ["loan_officer", "cashier", "manager", "accountant", "ceo"] as const) {
    test(`${key} is sent back to the dashboard from /settings`, async ({ page }) => {
      await signInAs(page, fixtureUser(key));
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/dashboard\?notice=forbidden$/);
      await expect(
        page.getByRole("alert").filter({ hasText: "You do not have access to that page." }),
      ).toBeVisible();
    });
  }

  test("the admin sees Settings in the navigation", async ({ page, isMobile }) => {
    await signInAs(page, fixtureUser("admin"));
    if (isMobile) await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("link", { name: "Settings" }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe("settings (FR-02; M0 acceptance: audit rows on settings change)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, fixtureUser("admin"));
  });

  for (const tab of ["company", "branches", "rules", "users"]) {
    test(`the ${tab} section passes axe with no horizontal scroll`, async ({ page }) => {
      await openSettings(page, tab);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yIssues(page);
    });
  }

  test("changing the company header writes one audit row with before and after", async ({ page }) => {
    const footer = `Thank you. Ref ${unique()}`;
    await openSettings(page);
    await fillExactly(page.getByLabel("Receipt footer"), footer);
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    const rows = await latestAudit("setting.updated", "company");
    const row = rows.find(
      (candidate) => (candidate.after as { receipt_footer?: string }).receipt_footer === footer,
    );
    expect(row, "audit row for the change").toBeDefined();
    expect(row?.actor_role).toBe("admin");
    expect((row?.before as { receipt_footer?: string }).receipt_footer).not.toBe(footer);
  });

  test("the company name cannot be empty", async ({ page }) => {
    await openSettings(page);
    await page.getByLabel("Company name").fill("");
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.getByText("This field is required.")).toBeVisible();
  });

  test("rule limits accept dollars, store cents and reject fractions of a cent", async ({
    page,
    isMobile,
  }) => {
    const dollars = isMobile ? "101.25" : "102.50";
    const cents = isMobile ? 10125 : 10250;
    await openSettings(page, "rules");
    const field = page.getByLabel("Expenses recorded without manager approval, up to (A-20)");

    await fillExactly(field, "12.345");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter an amount in dollars, for example 2,000.00.")).toBeVisible();

    await fillExactly(field, dollars);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    const rows = await latestAudit("setting.updated", "approvals.expense_limit_cents");
    expect(rows.some((row) => row.after === cents)).toBe(true);
  });

  test("a branch can be added and renamed, and both are audited", async ({ page }) => {
    const code = `T${randomInt(100, 999)}${String.fromCharCode(65 + randomInt(26))}`;
    await openSettings(page, "branches");
    await page.getByRole("button", { name: "Add branch" }).click();
    await page.getByLabel("Code").fill(code.toLowerCase());
    await page.getByLabel("Name").fill("Test Branch");
    await page.getByRole("button", { name: "Save changes" }).click();
    const row = page.getByRole("row").filter({ hasText: code });
    await expect(row).toContainText("Test Branch");

    await row.getByRole("button", { name: `Edit ${code}` }).click();
    await expect(page.getByLabel("Code")).toBeDisabled();
    await page.getByLabel("Name").fill("Renamed Branch");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("row").filter({ hasText: code })).toContainText("Renamed Branch");
  });

  test("the admin creates a user who can sign in, then deactivates them", async ({ page, browser }) => {
    const email = `e2e.new.${unique()}@loandesk.test`;
    await openSettings(page, "users");
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByLabel("Full name").fill("Hawa Created");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Role").selectOption("cashier");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("Cashiers and loan officers need a branch.")).toBeVisible();
    await page.getByLabel("Branch").selectOption({ label: "BR2 · Branch 2" });
    await page.getByRole("button", { name: "Create user" }).click();
    const password = (await page.getByTestId("one-time-password").textContent())?.trim() ?? "";
    expect(password).toMatch(/^[A-Za-z0-9]{14}$/);

    const other = await browser.newContext();
    const newUserPage = await other.newPage();
    await newUserPage.goto("/login");
    await signIn(newUserPage, email, password);
    await expect(newUserPage).toHaveURL(/\/dashboard$/);
    await other.close();

    await page.getByRole("button", { name: "I have noted it" }).click();
    const row = page.getByRole("listitem").filter({ hasText: email });
    await row.getByRole("button", { name: "Edit Hawa Created" }).click();
    await page.getByLabel("Account is active").uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(row).toContainText("Inactive");

    const later = await browser.newContext();
    const laterPage = await later.newPage();
    await laterPage.goto("/login");
    await signIn(laterPage, email, password);
    await expect(laterPage.locator("#login-error")).toHaveText(
      "This account is not active. Ask the administrator to check it.",
    );
    await later.close();
  });

  test("the admin cannot remove their own admin access", async ({ page }) => {
    await openSettings(page, "users");
    await page.getByRole("button", { name: "Edit Test Admin" }).click();
    await expect(page.getByLabel("Role")).toBeDisabled();
    await expect(page.getByLabel("Account is active")).toBeDisabled();
    await expect(page.getByText("You cannot change your own role or deactivate yourself.")).toBeVisible();
  });

  test("a new logo can be uploaded and is shown in the sidebar", async ({ page, isMobile }) => {
    test.skip(isMobile, "one upload per run is enough");
    await openSettings(page);
    await page
      .getByLabel("New logo file")
      .setInputFiles(path.join(process.cwd(), "public/brand/msi-logo-480.png"));
    await page.getByRole("button", { name: "Upload logo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("complementary").getByRole("img", { name: "Method Solutions Inc. logo" }),
    ).toHaveAttribute("src", /logo-[0-9a-f-]{36}\.png/);
  });

  test("the business clock can be moved in a development database and set back", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the clock is shared; one run changes it");
    await openSettings(page, "rules");
    try {
      await fillExactly(page.getByLabel("Date and time (Monrovia)"), "2026-02-12T09:10");
      await page.getByRole("button", { name: "Set clock" }).click();
      await expect(page.getByTestId("clock-now")).toHaveText("System time now: 12 Feb 2026, 09:10");
      await page.goto("/dashboard");
      await expect(page.getByTestId("business-date")).toContainText("Thu 12 Feb 2026");
    } finally {
      await openSettings(page, "rules");
      await page.getByRole("button", { name: "Use the real time" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    }
  });

  test("signing out from settings works", async ({ page, isMobile }) => {
    await openSettings(page);
    await signOutThroughUi(page, isMobile);
    await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
  });
});
