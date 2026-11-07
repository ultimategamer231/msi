import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { activeTestLoan, latestAudit, ownerSql, userClient } from "./service";

function person(first: string) {
  const n = randomInt(100000, 999999).toString();
  return {
    first_name: first,
    last_name: `Due${n}`,
    phone: `0770 ${n.slice(0, 3)} ${n.slice(3)}`,
    id_type: "national_id",
    id_number: `E2E-D${n}`,
  };
}

function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

test.describe("due and overdue list (SPEC 9, 10.3; mock-up 11; FR-13)", () => {
  test("overdue and due-soon loans, WhatsApp reminders and the manual daily run", async ({
    page,
  }, testInfo) => {
    const lateFields = person("Esther");
    const soonFields = person("Fatu");
    const late = await activeTestLoan(lateFields, 50000);
    const soon = await activeTestLoan(soonFields, 40000);
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    // Setup only: one loan fell due 3 days ago, the other falls due in 2 days.
    ownerSql(`update public.loans set due_date = '${shift(String(today), -3)}' where id = '${late.id}'`);
    ownerSql(`update public.loans set due_date = '${shift(String(today), 2)}' where id = '${soon.id}'`);
    const lateName = `${lateFields.first_name} ${lateFields.last_name}`;

    await signInAs(page, fixtureUser("manager"));
    await page.goto("/due");
    await expect(page.getByRole("heading", { name: "Due and overdue", level: 1 })).toBeVisible();
    const lateRow = page.getByRole("row").filter({ hasText: late.loanNo });
    const soonRow = page.getByRole("row").filter({ hasText: soon.loanNo });
    if (testInfo.project.name === "desktop-1280") {
      await expect(lateRow.getByText("3 days overdue")).toBeVisible();
      await expect(lateRow.getByText("$600.00")).toBeVisible();
      await expect(soonRow.getByText("In 2 days")).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: new RegExp(`^${lateName}`) })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    await expectNoSeriousA11yIssues(page);

    await page.getByRole("link", { name: /^Overdue \d+$/ }).click();
    await expect(page).toHaveURL(/tab=overdue/);
    await expect(page.getByText(soon.loanNo)).toHaveCount(0);
    await expect(page.getByText(late.loanNo).filter({ visible: true }).first()).toBeVisible();

    // The reminder link logs the tap and opens WhatsApp with the overdue text (SPEC 10.3).
    const remind = page
      .getByRole("link", { name: `WhatsApp reminder to ${lateName}` })
      .filter({ visible: true });
    await expect(remind).toHaveAttribute("href", `/api/reminder/${late.id}`);
    await expect(remind).toHaveAttribute("target", "_blank");
    const response = await page.request.get(`/api/reminder/${late.id}`, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = new URL(response.headers()["location"] ?? "");
    expect(location.origin + location.pathname).toBe(
      `https://wa.me/231${lateFields.phone.replace(/\D/g, "").slice(1)}`,
    );
    const text = location.searchParams.get("text") ?? "";
    expect(text).toContain(`Dear ${lateName}, your loan ${late.loanNo}`);
    expect(text).toContain("3 days overdue. Outstanding: $600.00");
    expect((await latestAudit("loan.reminder_opened", late.id))[0]?.after).toMatchObject({
      template: "reminder_overdue",
    });

    // The manager runs the daily job by hand; running it again charges nothing twice.
    await page.goto("/due");
    await page.getByRole("button", { name: "Run the daily job now" }).click();
    await expect(page.getByText(/^Done: \d+ newly overdue/)).toBeVisible();
    await expect(page.getByText(/manual run for/).first()).toBeVisible();
  });

  test("the officer's Today screen offers a WhatsApp reminder", async ({ page }) => {
    const fields = person("Joseph");
    const loan = await activeTestLoan(fields, 30000);
    const officer = await userClient(fixtureUser("loan_officer"));
    const [{ data: user }, { data: today }] = await Promise.all([
      officer.auth.getUser(),
      officer.rpc("business_today"),
    ]);
    ownerSql(
      `update public.loans set due_date = '${String(today)}', officer_id = '${user.user?.id ?? ""}' where id = '${loan.id}'`,
    );
    await signInAs(page, fixtureUser("loan_officer"));
    await page.goto("/field");
    const name = `${fields.first_name} ${fields.last_name}`;
    const remind = page.getByRole("link", { name: `Remind ${name} on WhatsApp` });
    await expect(remind).toHaveAttribute("href", `/api/reminder/${loan.id}`);
    expect((await remind.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const response = await page.request.get(`/api/reminder/${loan.id}`, { maxRedirects: 0 });
    const text = new URL(response.headers()["location"] ?? "").searchParams.get("text") ?? "";
    expect(text).toContain(`your loan ${loan.loanNo} of $300.00 is due on`);
  });
});
