import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signIn } from "./helpers";

test.describe("app shell (SPEC 9 layout, mock-ups 05-15 and 01-03)", () => {
  test.beforeEach(async ({ page }) => {
    const user = fixtureUser("cashier");
    await page.goto("/login");
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("desktop: sidebar with logo tile, active navigation and the user", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop layout");
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.getByRole("img", { name: "Method Solutions Inc. logo" })).toBeVisible();
    await expect(sidebar.getByText("Loan management")).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.getByText("Test Cashier")).toBeVisible();
    await expect(sidebar.getByText("Cashier", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true })).toHaveCount(1);
    await expect(page.locator("header").getByText("Branch 2", { exact: true })).toBeVisible();
  });

  test("desktop: only pages that exist and the role may open are listed", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop layout");
    const links = page.getByRole("complementary").getByRole("navigation").getByRole("link");
    await expect(links).toHaveText(["Dashboard", "Customers", "Loans", "Payments", "Approvals"]);
  });

  test("phone: purple header with context line, bottom tabs and the More sheet", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone layout");
    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByText("Test Cashier · Cashier · Branch 2")).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Main" });
    await expect(tabs.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    const tabBox = await tabs.getByRole("link", { name: "Dashboard" }).boundingBox();
    expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await tabs.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "All pages" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Signed in as Test Cashier, Cashier")).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    await sheet.getByRole("button", { name: "Close menu" }).click();
    await expect(sheet).toBeHidden();
  });

  test("the business date and branch are shown, with no horizontal scroll at 360px", async ({ page }) => {
    await expect(page.getByTestId("business-date")).toHaveText(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2} [A-Z][a-z]{2} \d{4} · Branch 2$/,
    );
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
  });

  test("a skip link jumps to the main content", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });
});
