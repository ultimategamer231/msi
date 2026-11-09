import { expect, test } from "@playwright/test";

import { fixtureUser, type FixtureKey } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";

const EXPECTED: Array<[Exclude<FixtureKey, "inactive">, string[]]> = [
  ["loan_officer", ["Due today", "Overdue", "Field cash to hand over", "My due and overdue loans"]],
  ["cashier", ["Collected today", "Cash to close", "Field cash not confirmed"]],
  [
    "manager",
    [
      "Outstanding",
      "Overdue",
      "Approvals waiting",
      "Overdue by age",
      "Needs attention",
      "Due and overdue now",
    ],
  ],
  ["ceo", ["Outstanding", "Approvals waiting", "Needs attention"]],
  ["accountant", ["Cash and equivalents", "Income this month", "Expenses waiting", "Cash by account"]],
  ["admin", ["Go-live date", "Last daily job", "Active users"]],
];

test.describe("role dashboards (SPEC 9 /dashboard; FR-29; mock-up 05)", () => {
  for (const [key, labels] of EXPECTED) {
    test(`${key} sees their own summary`, async ({ page }, testInfo) => {
      await signInAs(page, fixtureUser(key));
      const main = page.getByRole("main");
      for (const label of labels) await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
      if (key === "manager" || key === "cashier") {
        await expectNoSeriousA11yIssues(page);
        if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);
      }
    });
  }
});
