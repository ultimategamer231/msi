import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isActive, navigationFor } from "./navigation";
import { ROLES, canAccess } from "./permissions";

describe("navigationFor", () => {
  it("shows only built pages the role may open", () => {
    for (const role of ROLES) {
      for (const item of navigationFor(role)) {
        expect(item.built).toBe(true);
        expect(canAccess(role, item.route)).toBe(true);
      }
    }
  });

  it("gives every role the dashboard", () => {
    for (const role of ROLES) {
      expect(navigationFor(role).map((item) => item.href)).toContain("/dashboard");
    }
  });

  it("keeps the mock-up order", () => {
    const order = NAV_ITEMS.map((item) => item.key);
    expect(order.indexOf("customers")).toBeLessThan(order.indexOf("loans"));
    expect(order.indexOf("approvals")).toBeLessThan(order.indexOf("dayClose"));
    expect(order.indexOf("reports")).toBeLessThan(order.indexOf("ledger"));
  });
});

describe("isActive", () => {
  it("matches the page and its sub-pages only", () => {
    expect(isActive({ href: "/loans" }, "/loans")).toBe(true);
    expect(isActive({ href: "/loans" }, "/loans/abc")).toBe(true);
    expect(isActive({ href: "/loans" }, "/loans-archive")).toBe(false);
    expect(isActive({ href: "/loans" }, "/dashboard")).toBe(false);
  });
});
