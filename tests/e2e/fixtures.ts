import { readFileSync } from "node:fs";
import path from "node:path";

import type { Role } from "@/lib/permissions";

/* Test staff created by global-setup.ts with a fresh random password on every run. */
export type FixtureKey = Role | "inactive";

export interface FixtureUser {
  key: FixtureKey;
  email: string;
  password: string;
  fullName: string;
  role: Role;
  branchCode: string | null;
  active: boolean;
}

export const FIXTURES: ReadonlyArray<Omit<FixtureUser, "password">> = [
  {
    key: "admin",
    email: "e2e.admin@loandesk.test",
    fullName: "Test Admin",
    role: "admin",
    branchCode: null,
    active: true,
  },
  {
    key: "ceo",
    email: "e2e.ceo@loandesk.test",
    fullName: "Test Ceo",
    role: "ceo",
    branchCode: null,
    active: true,
  },
  {
    key: "manager",
    email: "e2e.manager@loandesk.test",
    fullName: "Test Manager",
    role: "manager",
    branchCode: null,
    active: true,
  },
  {
    key: "accountant",
    email: "e2e.accountant@loandesk.test",
    fullName: "Test Accountant",
    role: "accountant",
    branchCode: null,
    active: true,
  },
  {
    key: "cashier",
    email: "e2e.cashier@loandesk.test",
    fullName: "Test Cashier",
    role: "cashier",
    branchCode: "BR2",
    active: true,
  },
  {
    key: "loan_officer",
    email: "e2e.officer@loandesk.test",
    fullName: "Test Officer",
    role: "loan_officer",
    branchCode: "BR2",
    active: true,
  },
  {
    key: "inactive",
    email: "e2e.inactive@loandesk.test",
    fullName: "Test Former",
    role: "loan_officer",
    branchCode: "BR1",
    active: false,
  },
];

export const CREDENTIALS_FILE = path.join(process.cwd(), "tests", "e2e", ".auth", "users.json");

export function fixtureUser(key: FixtureKey): FixtureUser {
  const users = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8")) as FixtureUser[];
  const user = users.find((candidate) => candidate.key === key);
  if (user === undefined) throw new Error(`No e2e fixture user "${key}". Did global setup run?`);
  return user;
}
