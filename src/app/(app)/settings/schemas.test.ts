import { describe, expect, it } from "vitest";

import { branchSchema, companySchema, newUserSchema, rulesSchema } from "./schemas";

const RULES = {
  loanManagerLimit: "2,000.00",
  expenseLimit: "100",
  collateralRequired: true,
  multiLoan: false,
  extensionEnabled: true,
  requireRemittance: true,
  dayClosesEnforce: true,
  checkFunds: true,
  allocationOrder: ["penalty", "interest", "principal"],
  goLiveDate: "",
  dueUpcomingDays: "7",
} as const;

describe("rulesSchema", () => {
  it("accepts the seeded defaults", () => {
    expect(rulesSchema.safeParse(RULES).success).toBe(true);
  });

  it("rejects amounts that are not whole cents", () => {
    expect(rulesSchema.safeParse({ ...RULES, loanManagerLimit: "2000.505" }).success).toBe(false);
    expect(rulesSchema.safeParse({ ...RULES, expenseLimit: "-5" }).success).toBe(false);
    expect(rulesSchema.safeParse({ ...RULES, expenseLimit: "1e3" }).success).toBe(false);
  });

  it("requires each allocation component exactly once", () => {
    expect(
      rulesSchema.safeParse({ ...RULES, allocationOrder: ["interest", "interest", "principal"] }).success,
    ).toBe(false);
    expect(
      rulesSchema.safeParse({ ...RULES, allocationOrder: ["interest", "penalty", "principal"] }).success,
    ).toBe(true);
  });

  it("accepts an empty or real go-live date only", () => {
    expect(rulesSchema.safeParse({ ...RULES, goLiveDate: "2026-12-01" }).success).toBe(true);
    expect(rulesSchema.safeParse({ ...RULES, goLiveDate: "2026-02-30" }).success).toBe(false);
  });
});

describe("branchSchema", () => {
  it("upper-cases the code and checks its shape", () => {
    const parsed = branchSchema.parse({ code: "br4", name: "Gbarnga", address: "", phone: "", active: true });
    expect(parsed.code).toBe("BR4");
    expect(
      branchSchema.safeParse({ code: "4BR", name: "X", address: "", phone: "", active: true }).success,
    ).toBe(false);
  });
});

describe("newUserSchema", () => {
  const base = {
    fullName: "Grace Flomo",
    phone: "",
    email: "grace@msi.test",
    role: "cashier",
    branchId: "",
  } as const;

  it("requires a branch for cashiers and loan officers", () => {
    const result = newUserSchema.safeParse(base);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["branchId"]);
  });

  it("allows managers without a branch (B-11)", () => {
    expect(newUserSchema.safeParse({ ...base, role: "manager" }).success).toBe(true);
  });
});

describe("companySchema", () => {
  it("allows empty contact fields but not an empty name", () => {
    const company = {
      name: "Method Solutions Inc.",
      shortName: "MSI",
      address: "",
      phone: "",
      email: "",
      receiptFooter: "",
    };
    expect(companySchema.safeParse(company).success).toBe(true);
    expect(companySchema.safeParse({ ...company, name: "  " }).success).toBe(false);
    expect(companySchema.safeParse({ ...company, email: "not-an-email" }).success).toBe(false);
  });
});
