/*
 * Route access by role: the single source for the route guard and the navigation.
 *
 * Source: SPEC section 9 (routes and roles). Where SPEC section 4 grants a role the action a page
 * exists for (for example admin "Create customer", or admin read access to the ledger), the role
 * is added here too; those additions are marked "SPEC 4". This is the UI guard only: every RPC and
 * RLS policy checks the role again in Postgres (SPEC 6.4).
 */
import type { Database } from "@/types/database";

export type Role = Database["public"]["Enums"]["app_role"];

export const ROLES = [
  "admin",
  "ceo",
  "manager",
  "accountant",
  "cashier",
  "loan_officer",
] as const satisfies readonly Role[];

type Access = "public" | "staff" | readonly Role[];

/** Route patterns use Next.js segment syntax: `[id]` is one dynamic segment, `[...rest]` is one or more. */
export const ROUTES = {
  "/login": "public",
  "/verify/[token]": "public",
  "/api/health": "public",
  "/api/pdf/[kind]/[id]": "staff", // SPEC 10.1; each kind checks the record and role again

  "/dashboard": "staff",
  "/customers": "staff",
  "/customers/new": ["loan_officer", "manager", "admin"], // admin: SPEC 4 "Create customer"
  "/customers/[id]": "staff",
  "/loans": "staff",
  "/loans/new": ["loan_officer", "manager"],
  "/loans/[id]": "staff",
  "/payments/new": ["cashier", "manager"],
  "/payments": ["cashier", "manager", "accountant", "ceo"],
  "/receipts/[id]": "staff",
  "/field": ["loan_officer"],
  "/field/collect/[loanId]": ["loan_officer"],
  "/remittance": ["cashier", "manager"],
  "/due": "staff",
  "/collateral": "staff",
  "/collateral/new": ["loan_officer", "cashier", "manager"],
  "/collateral/[id]": "staff",
  "/recovery": ["manager", "ceo"],
  "/recovery/[caseId]": ["manager", "ceo"],
  "/approvals": "staff", // manager and CEO decide; everyone else sees the requests they made
  "/day-close": ["cashier", "manager", "ceo"],
  "/expenses": ["manager", "accountant"],
  "/payees": ["manager", "accountant"],
  "/reports": ["ceo", "manager", "accountant", "admin"],
  "/reports/[...report]": ["ceo", "manager", "accountant", "admin"],
  "/ledger": ["accountant", "manager", "ceo", "admin"], // admin: SPEC 4 read access to the ledger
  "/settings": ["admin"],
  "/audit": ["manager", "ceo", "admin"],
} as const satisfies Record<string, Access>;

export type RouteKey = keyof typeof ROUTES;

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith("[...") && segment.endsWith("]")) return "[^/]+(?:/[^/]+)*";
      if (segment.startsWith("[") && segment.endsWith("]")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${source}/?$`);
}

const MATCHERS: ReadonlyArray<{ key: RouteKey; regExp: RegExp; dynamic: boolean }> = (
  Object.keys(ROUTES) as RouteKey[]
)
  .map((key) => ({ key, regExp: patternToRegExp(key), dynamic: key.includes("[") }))
  // Static routes win over dynamic ones ("/customers/new" before "/customers/[id]").
  .sort((a, b) => Number(a.dynamic) - Number(b.dynamic));

/** The route pattern a concrete path belongs to, or undefined for unknown paths. */
export function matchRoute(pathname: string): RouteKey | undefined {
  return MATCHERS.find((matcher) => matcher.regExp.test(pathname))?.key;
}

/** True for paths anyone may open without signing in. */
export function isPublicPath(pathname: string): boolean {
  const key = matchRoute(pathname);
  return key !== undefined && ROUTES[key] === "public";
}

/** Whether a signed-in staff member with this role may open the route. */
export function canAccess(role: Role, route: RouteKey): boolean {
  const access: Access = ROUTES[route];
  if (access === "public" || access === "staff") return true;
  return access.includes(role);
}

/**
 * A safe internal path to return to after sign-in. Rejects absolute URLs, protocol-relative
 * URLs ("//evil.example") and back-slash tricks so the redirect cannot leave the site.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (next === null || next === undefined || next === "") return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/dashboard";
  if (next === "/" || next.startsWith("/login")) return "/dashboard";
  return next;
}
