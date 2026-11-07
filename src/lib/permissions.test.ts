import { describe, expect, it } from "vitest";

import {
  ROLES,
  ROUTES,
  canAccess,
  isPublicPath,
  matchRoute,
  safeNextPath,
  type Role,
  type RouteKey,
} from "./permissions";

const ALL: readonly Role[] = ROLES;

/*
 * Expected access, written out independently from SPEC section 9 (plus the SPEC 4 additions
 * documented in permissions.ts). If the map changes, this table must change on purpose.
 */
const EXPECTED: Record<Exclude<RouteKey, "/login" | "/verify/[token]" | "/api/health">, readonly Role[]> = {
  "/dashboard": ALL,
  "/api/pdf/[kind]/[id]": ALL,
  "/api/reminder/[loanId]": ALL,
  "/customers": ALL,
  "/customers/new": ["loan_officer", "manager", "admin"],
  "/customers/[id]": ALL,
  "/loans": ALL,
  "/loans/new": ["loan_officer", "manager"],
  "/loans/[id]": ALL,
  "/payments/new": ["cashier", "manager"],
  "/payments": ["cashier", "manager", "accountant", "ceo"],
  "/receipts/[id]": ALL,
  "/field": ["loan_officer"],
  "/field/collect/[loanId]": ["loan_officer"],
  "/remittance": ["cashier", "manager"],
  "/due": ALL,
  "/collateral": ALL,
  "/collateral/new": ["loan_officer", "cashier", "manager"],
  "/collateral/[id]": ALL,
  "/recovery": ["manager", "ceo"],
  "/recovery/[caseId]": ["manager", "ceo"],
  "/approvals": ALL,
  "/day-close": ["cashier", "manager", "ceo"],
  "/expenses": ["manager", "accountant"],
  "/payees": ["manager", "accountant"],
  "/reports": ["ceo", "manager", "accountant", "admin"],
  "/reports/[...report]": ["ceo", "manager", "accountant", "admin"],
  "/ledger": ["accountant", "manager", "ceo", "admin"],
  "/settings": ["admin"],
  "/audit": ["manager", "ceo", "admin"],
};

describe("canAccess", () => {
  for (const [route, allowed] of Object.entries(EXPECTED) as [keyof typeof EXPECTED, readonly Role[]][]) {
    for (const role of ROLES) {
      const expected = allowed.includes(role);
      it(`${role} ${expected ? "may" : "may not"} open ${route}`, () => {
        expect(canAccess(role, route)).toBe(expected);
      });
    }
  }

  it("covers every route in the map", () => {
    const covered = new Set([...Object.keys(EXPECTED), "/login", "/verify/[token]", "/api/health"]);
    expect(new Set(Object.keys(ROUTES))).toEqual(covered);
  });
});

describe("matchRoute", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/customers", "/customers"],
    ["/customers/new", "/customers/new"],
    ["/customers/7d3c", "/customers/[id]"],
    ["/field/collect/abc", "/field/collect/[loanId]"],
    ["/reports/overdue", "/reports/[...report]"],
    ["/reports/overdue/print", "/reports/[...report]"],
    ["/verify/AbCdEf123", "/verify/[token]"],
    ["/settings/", "/settings"],
  ])("maps %s to %s", (path, key) => {
    expect(matchRoute(path)).toBe(key);
  });

  it("returns undefined for unknown paths", () => {
    expect(matchRoute("/nowhere")).toBeUndefined();
    expect(matchRoute("/customers/1/extra")).toBeUndefined();
  });
});

describe("isPublicPath", () => {
  it("allows sign-in, verification and health without a session", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/verify/token123")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
  });

  it("protects everything else, including unknown paths", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/unknown")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps internal paths", () => {
    expect(safeNextPath("/loans/123")).toBe("/loans/123");
    expect(safeNextPath("/due?tab=overdue")).toBe("/due?tab=overdue");
  });

  it.each([
    null,
    undefined,
    "",
    "/",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/login?next=/x",
  ])("falls back to /dashboard for %s", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });
});
