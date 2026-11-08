import { canAccess, type Role, type RouteKey } from "@/lib/permissions";

/*
 * Main navigation, in the order of the approved mock-ups (05-15). An item appears only when its
 * page exists (`built`) and the role may open it (src/lib/permissions.ts), so nobody sees links to
 * pages they cannot use or that are not built yet. Flip `built` in the block that delivers a page.
 */
export type NavIcon =
  | "dashboard"
  | "field"
  | "customers"
  | "loans"
  | "payments"
  | "remittance"
  | "due"
  | "collateral"
  | "recovery"
  | "approvals"
  | "dayClose"
  | "expenses"
  | "reports"
  | "ledger"
  | "audit"
  | "settings";

export interface NavItem {
  key: NavIcon;
  href: string;
  route: RouteKey;
  built: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", href: "/dashboard", route: "/dashboard", built: true },
  { key: "field", href: "/field", route: "/field", built: true },
  { key: "customers", href: "/customers", route: "/customers", built: true },
  { key: "loans", href: "/loans", route: "/loans", built: true },
  { key: "payments", href: "/payments", route: "/payments", built: true },
  { key: "remittance", href: "/remittance", route: "/remittance", built: true },
  { key: "due", href: "/due", route: "/due", built: true },
  { key: "collateral", href: "/collateral", route: "/collateral", built: true },
  { key: "recovery", href: "/recovery", route: "/recovery", built: false },
  { key: "approvals", href: "/approvals", route: "/approvals", built: true },
  { key: "dayClose", href: "/day-close", route: "/day-close", built: false },
  { key: "expenses", href: "/expenses", route: "/expenses", built: false },
  { key: "reports", href: "/reports", route: "/reports", built: false },
  { key: "ledger", href: "/ledger", route: "/ledger", built: true },
  { key: "audit", href: "/audit", route: "/audit", built: true },
  { key: "settings", href: "/settings", route: "/settings", built: true },
];

export function navigationFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.built && canAccess(role, item.route));
}

/** True when `pathname` is the item's page or one of its sub-pages. */
export function isActive(item: Pick<NavItem, "href">, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
