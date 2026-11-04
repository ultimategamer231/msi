import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { ownerSql } from "./service";

const memo = `E2E capital ${Date.now().toString(36)}${randomInt(1000, 9999)}`;

test.beforeAll(() => {
  // A real journal through post_journal (the only writer), as the local database owner.
  ownerSql(
    `select public.post_journal('2026-02-11', '${memo}', 'capital', null,
       (select id from public.branches where code = 'BR2'),
       '[{"account": "1010-BR2", "debit_cents": 123456}, {"account": "3000", "credit_cents": 123456}]')`,
  );
});

test.describe("ledger (FR-21; SPEC 9 /ledger for accountant, manager, CEO, admin)", () => {
  for (const key of ["cashier", "loan_officer"] as const) {
    test(`${key} cannot open the ledger`, async ({ page }) => {
      await signInAs(page, fixtureUser(key));
      await page.goto("/ledger");
      await expect(page).toHaveURL(/\/dashboard\?notice=forbidden$/);
    });
  }

  test("the accountant sees the journal and its lines", async ({ page }) => {
    await signInAs(page, fixtureUser("accountant"));
    await page.goto("/ledger");
    await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
    const entry = page.getByRole("listitem").filter({ hasText: memo });
    await expect(entry).toContainText("11 Feb 2026");
    await expect(entry).toContainText("$1,234.56");
    await entry.getByText("Show lines").click();
    await expect(entry.getByRole("row").filter({ hasText: "1010-BR2" })).toContainText("$1,234.56");
    await expect(entry.getByRole("row").filter({ hasText: "3000" })).toContainText("Owner's Capital");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("the trial balance is balanced and shows the totals", async ({ page }) => {
    await signInAs(page, fixtureUser("manager"));
    await page.goto("/ledger?tab=trial&asof=2026-12-31");
    await expect(page.getByRole("heading", { name: "Trial balance as at 31 Dec 2026" })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Balanced: total debits equal total credits." }),
    ).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Owner's Capital" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yIssues(page);
  });

  test("the admin and the CEO can open the ledger", async ({ page }) => {
    for (const key of ["admin", "ceo"] as const) {
      await signInAs(page, fixtureUser(key));
      await page.goto("/ledger");
      await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
      await page.context().clearCookies();
    }
  });
});
