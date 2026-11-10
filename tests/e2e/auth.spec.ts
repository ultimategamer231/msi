import { expect, test } from "@playwright/test";

import { fixtureUser, type FixtureKey } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signIn, signOutThroughUi } from "./helpers";

const ROLE_LABELS: Record<Exclude<FixtureKey, "inactive">, string> = {
  admin: "Administrator",
  ceo: "CEO",
  manager: "Manager",
  accountant: "Accountant",
  cashier: "Cashier",
  loan_officer: "Loan officer",
};

test.describe("sign-in (FR-01, M0 acceptance: login works per role)", () => {
  test("the sign-in page shows the company name, has no sign-up link and passes axe", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Method Solutions Inc.")).toBeVisible();
    // B-22: the logo is shown on the public sign-in page.
    await expect(page.getByRole("img", { name: "Method Solutions Inc. logo" })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up|register|create account/i })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  for (const [key, label] of Object.entries(ROLE_LABELS) as [Exclude<FixtureKey, "inactive">, string][]) {
    test(`${label} signs in and lands on the dashboard`, async ({ page }) => {
      const user = fixtureUser(key);
      await page.goto("/login");
      await signIn(page, user.email, user.password);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(
        `Good day, ${user.fullName.split(" ")[0]}`,
      );
      await expect(
        page
          .getByText(new RegExp(`(^|· )${label}( ·|$)`))
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(page.getByTestId("business-date")).toContainText(
        user.branchCode === null ? "All branches" : "Margibi Branch",
      );
    });
  }

  test("a wrong password gets a message that does not reveal whether the email exists", async ({ page }) => {
    const user = fixtureUser("cashier");
    await page.goto("/login");
    await signIn(page, user.email, `${user.password}-wrong`);
    await expect(page.locator("#login-error")).toHaveText("The email or password is not correct.");
    await signIn(page, "nobody@loandesk.test", "not-a-real-password");
    await expect(page.locator("#login-error")).toHaveText("The email or password is not correct.");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a deactivated user cannot sign in", async ({ page }) => {
    const user = fixtureUser("inactive");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page.locator("#login-error")).toHaveText(
      "This account is not active. Ask the administrator to check it.",
    );
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });
});

test.describe("route guard (M0 acceptance: unauthorised routes redirect)", () => {
  test("a signed-out visitor is sent to sign in and returned to the page afterwards", async ({ page }) => {
    const user = fixtureUser("manager");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a signed-in user opening /login goes to the dashboard", async ({ page }) => {
    const user = fixtureUser("accountant");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("signing out ends the session", async ({ page, isMobile }) => {
    const user = fixtureUser("loan_officer");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await signOutThroughUi(page, isMobile);
    await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
    await expect(page.getByRole("status")).toHaveText("You have signed out.");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test("unknown pages show the designed not-found page when signed in", async ({ page }) => {
    const user = fixtureUser("cashier");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("the dashboard passes axe and has no horizontal scroll", async ({ page }) => {
    const user = fixtureUser("manager");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });
});
