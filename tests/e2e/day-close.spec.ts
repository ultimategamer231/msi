import { expect, test } from "@playwright/test";

import { fixtureUser } from "./fixtures";
import { expectNoHorizontalScroll, expectNoSeriousA11yIssues, signInAs } from "./helpers";
import { serviceClient, userClient } from "./service";

function shift(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/*
 * The cashier closes a day long past, so the lock never touches the days other tests post to;
 * each viewport uses its own day. The payment-after-close rule (T-34) is covered in pgTAP.
 */
test.describe("day close (SPEC 5.10; mock-up 14; FR-23)", () => {
  test("the cashier counts with a reason, the manager approves, then reopens", async ({ page }, testInfo) => {
    const manager = await userClient(fixtureUser("manager"));
    const { data: today } = await manager.rpc("business_today");
    const day = shift(String(today), testInfo.project.name === "phone-390" ? -400 : -401);

    // A run that stopped half-way leaves its close behind: send it back first.
    const { data: branch } = await serviceClient().from("branches").select("id").eq("code", "BR2").single();
    const { data: left } = await serviceClient()
      .from("day_closes")
      .select("id, status")
      .eq("branch_id", String(branch?.id))
      .eq("close_date", day)
      .in("status", ["submitted", "approved"]);
    for (const close of left ?? []) {
      if (close.status === "approved")
        await manager.rpc("reopen_day_close", { p_id: close.id, p_reason: "Test reset" });
      else {
        const { data: request } = await serviceClient()
          .from("approval_requests")
          .select("id")
          .eq("entity_id", close.id)
          .eq("status", "pending")
          .single();
        await manager.rpc("decide_approval", {
          p_id: String(request?.id),
          p_decision: "reject",
          p_note: "Test reset",
        });
      }
    }

    await signInAs(page, fixtureUser("cashier"));
    await page.goto(`/day-close?date=${day}`);
    await expect(page.getByRole("heading", { name: "Day close, Branch 2" })).toBeVisible();
    const count = page.getByRole("region", { name: "Count" });
    await count.getByLabel("Cash counted in drawer ($)").fill("1.00");
    await expect(count.getByText("+$1.00")).toBeVisible();
    await count.getByRole("button", { name: "Close day" }).click();
    await expect(count.getByText("Give a reason for the variance.")).toBeVisible();
    await count.getByLabel("Reason for variance (required)").fill("Found a coin in the drawer");
    await count.getByRole("button", { name: "Close day" }).click();
    await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();
    await expectNoSeriousA11yIssues(page);
    if (testInfo.project.name === "phone-390") await expectNoHorizontalScroll(page);

    await page.context().clearCookies();
    await signInAs(page, fixtureUser("manager"));
    await page.goto(`/day-close?branch=${branch?.id}&date=${day}`);
    const review = page.getByRole("region", { name: "Count" });
    await expect(review.getByText("Found a coin in the drawer")).toBeVisible();
    await review.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Closed", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Reopen day" }).click();
    await review.getByLabel("Reason for reopening").fill("A late payment for this day");
    await review.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(page.getByText("Not closed", { exact: true })).toBeVisible();
    await expect(review.getByText(/This day was reopened: A late payment for this day/)).toBeVisible();
    await expectNoSeriousA11yIssues(page);
  });
});
