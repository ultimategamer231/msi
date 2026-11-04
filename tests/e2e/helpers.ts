import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

/** Fail on serious or critical WCAG 2.2 AA violations (master prompt section 5). */
export async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  // Scan the settled page: during the 200 ms fade-in, text is briefly translucent and would be
  // measured at the wrong contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

/** SPEC 11: no horizontal scroll at phone widths. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Signs in through the real form. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs out through the visible UI: the sidebar button on desktop, the "More" sheet on phones. */
export async function signOutThroughUi(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("complementary").getByRole("button", { name: "Sign out" }).click();
  }
}

/** Signs in as one of the fixture users and waits for the dashboard. */
export async function signInAs(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Fills an input and confirms it holds exactly that value. A fill that lands before React has
 * hydrated the form can be merged with the server-rendered value, so it is retried until it sticks.
 */
export async function fillExactly(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}
