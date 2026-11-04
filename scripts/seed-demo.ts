/*
 * Demo seed (SPEC 14, docs/DEMO_DATA.md): `pnpm seed:demo [--as-of YYYY-MM-DD]`.
 *
 * M0 part: the demo staff accounts and branch names. Later milestones extend this script with
 * loans, payments and the rest, always through the RPCs (never by inserting journals).
 *
 *  - Local Supabase only, and only when the database is a development, demo or test environment.
 *  - Only the first admin's profile is written directly (bootstrap, as the database owner); every
 *    other change goes through the audited RPCs signed in as that admin.
 *  - The business clock (B-01) is moved so records carry demo-story timestamps, then left at the
 *    morning of the anchor date A (09:10) when --as-of is given, or set back to real time.
 *  - Passwords are generated on every run and printed once. They are never written to disk.
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/types/database";

type Role = Database["public"]["Enums"]["app_role"];

interface DemoUser {
  fullName: string;
  role: Role;
  branchCode: string | null;
  email: string;
}

// docs/DEMO_DATA.md "Users". Emails use the reserved .test domain.
const DEMO_USERS: readonly DemoUser[] = [
  { fullName: "Corex Admin", role: "admin", branchCode: null, email: "corex.admin@msi-demo.test" },
  { fullName: "Musa Kanneh", role: "ceo", branchCode: null, email: "musa.kanneh@msi-demo.test" },
  { fullName: "Rebecca Wolo", role: "manager", branchCode: null, email: "rebecca.wolo@msi-demo.test" },
  { fullName: "Grace Flomo", role: "cashier", branchCode: "BR2", email: "grace.flomo@msi-demo.test" },
  {
    fullName: "Emmanuel Tarpeh",
    role: "loan_officer",
    branchCode: "BR2",
    email: "emmanuel.tarpeh@msi-demo.test",
  },
  { fullName: "Ruth Browne", role: "loan_officer", branchCode: "BR1", email: "ruth.browne@msi-demo.test" },
  {
    fullName: "David Kerkula",
    role: "loan_officer",
    branchCode: "BR3",
    email: "david.kerkula@msi-demo.test",
  },
  { fullName: "Peter Zayzay", role: "accountant", branchCode: null, email: "peter.zayzay@msi-demo.test" },
];

// docs/DEMO_DATA.md "Branches" (names are placeholders until MSI supplies them).
const DEMO_BRANCHES = [
  { code: "BR1", name: "Main" },
  { code: "BR2", name: "Branch 2" },
  { code: "BR3", name: "Branch 3" },
] as const;

// Staff accounts are created well before the first demo record (Mariama Kollie registered A-133).
const STAFF_CREATED_DAYS_BEFORE_ANCHOR = 140;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const password = () => Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

function supabaseCli(args: string[]): string {
  return execFileSync("pnpm", ["-s", "supabase", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Runs one SQL statement as the local database owner and returns the result rows. */
function ownerQuery<T>(sql: string): T[] {
  const output = supabaseCli(["db", "query", sql]).trim();
  // Statements without result rows print a plain status line such as "INSERT 0 1".
  if (!output.startsWith("{")) return [];
  return (JSON.parse(output) as { rows?: T[] }).rows ?? [];
}

function sqlText(value: string | null): string {
  return value === null ? "null" : `'${value.replace(/'/g, "''")}'`;
}

function todayInMonrovia(): string {
  return new Date().toISOString().slice(0, 10); // Africa/Monrovia is UTC+0 all year (D-06)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function rpc(
  client: SupabaseClient<Database>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name as never, args as never);
  if (error !== null) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { "as-of": { type: "string" } } });
  const anchorGiven = values["as-of"] !== undefined;
  const anchor = values["as-of"] ?? todayInMonrovia();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || Number.isNaN(Date.parse(`${anchor}T00:00:00Z`))) {
    throw new Error(`--as-of must be a date YYYY-MM-DD, got "${anchor}"`);
  }

  const status = JSON.parse(supabaseCli(["status", "-o", "json"])) as Record<string, string | undefined>;
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = status;
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY)
    throw new Error("Local Supabase is not running. Run `pnpm db:start`.");

  const [environment] = ownerQuery<{ kind: string }>("select public.environment_kind() as kind");
  if (!environment || !["development", "demo", "test"].includes(environment.kind)) {
    throw new Error(`Refusing to seed demo data into a "${environment?.kind ?? "unknown"}" database.`);
  }

  const service = createClient<Database>(API_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error !== null) throw error;
    for (const user of data.users) if (user.email !== undefined) existing.set(user.email, user.id);
    if (data.users.length < 200) break;
  }

  // 1. Sign-in accounts with fresh passwords.
  const accounts: Array<DemoUser & { id: string; password: string }> = [];
  for (const user of DEMO_USERS) {
    const secret = password();
    let id = existing.get(user.email);
    if (id === undefined) {
      const { data, error } = await service.auth.admin.createUser({
        email: user.email,
        password: secret,
        email_confirm: true,
      });
      if (error !== null) throw error;
      id = data.user.id;
    } else {
      const { error } = await service.auth.admin.updateUserById(id, { password: secret });
      if (error !== null) throw error;
    }
    accounts.push({ ...user, id, password: secret });
  }

  // 2. Bootstrap the first admin's profile as the database owner (no admin exists to do it yet).
  const admin = accounts.find((account) => account.role === "admin");
  if (admin === undefined) throw new Error("DEMO_USERS has no admin");
  ownerQuery(
    `insert into public.profiles (id, full_name, role, active, created_at, updated_at)
     values (${sqlText(admin.id)}, ${sqlText(admin.fullName)}, 'admin', true,
             '${addDays(anchor, -STAFF_CREATED_DAYS_BEFORE_ANCHOR)}T08:00:00Z', '${addDays(anchor, -STAFF_CREATED_DAYS_BEFORE_ANCHOR)}T08:00:00Z')
     on conflict (id) do update set full_name = excluded.full_name, role = 'admin', active = true`,
  );

  // 3. Everything else through the audited RPCs, signed in as the admin.
  const client = createClient<Database>(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: admin.email,
    password: admin.password,
  });
  if (signInError !== null) throw signInError;

  await rpc(client, "update_setting", {
    p_key: "clock.override_at",
    p_value: { at: `${addDays(anchor, -STAFF_CREATED_DAYS_BEFORE_ANCHOR)}T08:05:00Z`, frozen: true },
  });

  const branchRows = ownerQuery<{ id: string; code: string; name: string }>(
    "select id, code, name from public.branches",
  );
  const branchId = new Map(branchRows.map((branch) => [branch.code, branch.id]));
  for (const branch of DEMO_BRANCHES) {
    const id = branchId.get(branch.code);
    await rpc(client, "upsert_branch", { p_branch: id === undefined ? branch : { id, name: branch.name } });
  }
  const refreshed = ownerQuery<{ id: string; code: string }>("select id, code from public.branches");
  const branchIds = new Map(refreshed.map((branch) => [branch.code, branch.id]));

  for (const account of accounts) {
    if (account.role === "admin") continue;
    await rpc(client, "admin_set_profile", {
      p_user_id: account.id,
      p_full_name: account.fullName,
      p_phone: null,
      p_role: account.role,
      p_branch_id: account.branchCode === null ? null : (branchIds.get(account.branchCode) ?? null),
      p_active: true,
    });
  }

  // 4. Leave the clock at the morning of A (DEMO_DATA "Seeded state"), or at real time.
  await rpc(client, "update_setting", {
    p_key: "clock.override_at",
    p_value: anchorGiven ? { at: `${anchor}T09:10:00Z`, frozen: true } : null,
  });
  await client.auth.signOut();

  console.log(
    `\nDemo seed complete (anchor ${anchor}${anchorGiven ? ", clock frozen at 09:10" : ", real-time clock"}).`,
  );
  console.log("Passwords are shown once and are not saved anywhere. Note the ones you need.\n");
  console.table(
    accounts.map((account) => ({
      name: account.fullName,
      role: account.role,
      branch: account.branchCode ?? "All",
      email: account.email,
      password: account.password,
    })),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
