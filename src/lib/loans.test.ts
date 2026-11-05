import { describe, expect, it } from "vitest";

import { loanPill } from "./loans";

const base = {
  dueDate: "2026-03-11",
  daysOverdue: 0,
  totalOutCents: 60000n,
  closedOn: null,
  today: "2026-02-12",
};

describe("loanPill", () => {
  it("shows active, due today and days overdue from the due date and balance", () => {
    expect(loanPill({ ...base, status: "active" })).toEqual({ key: "active", tone: "active" });
    expect(loanPill({ ...base, status: "active", dueDate: "2026-02-12" })).toEqual({
      key: "dueToday",
      tone: "due",
    });
    expect(loanPill({ ...base, status: "active", dueDate: "2026-02-05", daysOverdue: 7 })).toEqual({
      key: "overdue",
      tone: "overdue",
      days: 7,
    });
    expect(loanPill({ ...base, status: "overdue", daysOverdue: 21 })).toMatchObject({
      key: "overdue",
      days: 21,
    });
  });

  it("names the approver level while waiting and recent closures with their date", () => {
    expect(loanPill({ ...base, status: "pending_approval", pendingRole: "ceo" }).key).toBe("pendingCeo");
    expect(loanPill({ ...base, status: "pending_approval", pendingRole: null }).key).toBe("pendingApproval");
    expect(loanPill({ ...base, status: "closed", closedOn: "2026-02-11", totalOutCents: 0n })).toEqual({
      key: "closedOn",
      tone: "pending",
      date: "2026-02-11",
    });
    expect(loanPill({ ...base, status: "closed", closedOn: "2025-12-10", totalOutCents: 0n }).key).toBe(
      "closed",
    );
    expect(loanPill({ ...base, status: "recovery" })).toEqual({ key: "recovery", tone: "recovery" });
  });
});
