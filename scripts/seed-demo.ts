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

// docs/DEMO_DATA.md "Branches" (MSI's branch names, 2026-11-09).
const DEMO_BRANCHES = [
  { code: "BR1", name: "Jallah Town Branch" },
  { code: "BR2", name: "Margibi Branch" },
  { code: "BR3", name: "Nimba Branch" },
] as const;

interface DemoCustomer {
  type: "individual" | "business";
  officerEmail: string;
  registeredDaysBefore: number;
  fields: Record<string, string | null>;
}

const MARIAMA_ID = "LR-0012345";
const officer = {
  BR1: "ruth.browne@msi-demo.test",
  BR2: "emmanuel.tarpeh@msi-demo.test",
  BR3: "david.kerkula@msi-demo.test",
} as const;
const person = (
  first: string,
  last: string,
  phone: string,
  idNumber: string,
  extra: Record<string, string | null> = {},
) => ({
  first_name: first,
  last_name: last,
  phone,
  id_type: "national_id",
  id_number: idNumber,
  ...extra,
});

/*
 * docs/DEMO_DATA.md customers, in registration order (codes CU-000001..12, Mariama Kollie 8th on
 * 02 Oct 2025 = A-133). Details not given in DEMO_DATA (other phones, ID numbers, occupations,
 * registration days) are demo placeholders in the same style.
 */
const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    type: "individual",
    officerEmail: officer.BR1,
    registeredDaysBefore: 139,
    fields: person("Prince", "Karmo", "0770 555 081", "LR-0012301", { occupation: "Tailor" }),
  },
  {
    type: "business",
    officerEmail: officer.BR1,
    registeredDaysBefore: 138,
    fields: {
      business_name: "Dolo & Sons Trading",
      registration_no: "BRN-2019-4471",
      contact_person: "James Dolo",
      phone: "0770 555 071",
      address: "Waterside Market, Monrovia",
      occupation: "Wholesale trade",
    },
  },
  {
    type: "individual",
    officerEmail: officer.BR3,
    registeredDaysBefore: 137,
    fields: person("Mohammed", "Sheriff", "0770 555 058", "LR-0012303", { occupation: "Taxi driver" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR3,
    registeredDaysBefore: 136,
    fields: person("Fatu", "Kamara", "0770 555 047", "LR-0012304", { occupation: "Shop owner" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 135,
    fields: person("Esther", "Toe", "0770 555 021", "LR-0012305", { occupation: "Hairdresser" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 134,
    fields: person("Joseph B.", "Gbessay", "0770 555 033", "LR-0012306", { occupation: "Shop owner" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 134,
    fields: person("Musu", "Freeman", "0770 555 074", "LR-0012307", { occupation: "Seamstress" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 133,
    fields: person("Mariama", "Kollie", "0770 555 010", MARIAMA_ID, {
      address: "Montserrado County",
      occupation: "Market trader",
      next_of_kin_name: "Joseph Kollie",
      next_of_kin_relation: "brother",
      next_of_kin_phone: "0770 555 014",
    }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 120,
    fields: person("Comfort", "Weah", "0770 555 066", "LR-0012309", { occupation: "Food seller" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 100,
    fields: person("Alieu", "Sesay", "0770 555 091", "LR-0012310", { occupation: "Mechanic" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR2,
    registeredDaysBefore: 60,
    fields: person("Hawa", "Dukuly", "0770 555 052", "LR-0012311", { occupation: "Seamstress" }),
  },
  {
    type: "individual",
    officerEmail: officer.BR1,
    registeredDaysBefore: 20,
    fields: person("Kpanah", "Mulbah", "0770 555 061", "LR-0012312", { occupation: "Farmer" }),
  },
];

// Opening capital (R10) on 01 Nov 2025 = A-103 for the demo anchor. Placeholder amounts until the
// M8 day-close reconciliation; every demo loan is paid out from Branch 2 cash by Grace Flomo (B-10).
const DEMO_CAPITAL_DAYS_BEFORE = 103;
// Chosen so the drawers open A−1 at DEMO_DATA's $5,000.00, $2,000.00 and $3,000.00. Grace Flomo is
// the only cashier, so every payout and counter receipt before A−1 moved through the Branch 2 drawer
// (net $6,125.00 out); Branch 1 and Branch 3 hold only their capital.
const DEMO_CAPITAL: ReadonlyArray<[string, number]> = [
  ["1010-BR1", 500000],
  ["1010-BR2", 812500],
  ["1010-BR3", 300000],
];

interface DemoCollateral {
  number: number;
  loanNo: string;
  owner: string;
  officerEmail: string;
  type: string;
  description: string;
  serialNo?: string;
  plateNo?: string;
  documentNo?: string;
  valueCents: number;
  location: string;
  daysBefore: number;
}

// docs/DEMO_DATA.md "Collateral", in COL order, registered on the day of their loan.
const DEMO_COLLATERAL: readonly DemoCollateral[] = [
  {
    number: 19,
    loanNo: "LN-BR2-00002",
    owner: "LR-0012345",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Mobile phone",
    valueCents: 25000,
    location: "Branch 2 safe",
    daysBefore: 94,
  },
  {
    number: 22,
    loanNo: "LN-BR2-00006",
    owner: "LR-0012307",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Sewing machine",
    serialNo: "SM-4410",
    valueCents: 65000,
    location: "Branch 2 safe",
    daysBefore: 30,
  },
  {
    number: 24,
    loanNo: "LN-BR2-00003",
    owner: "LR-0012309",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Mobile phone",
    serialNo: "IMEI 3561 0902 7781",
    valueCents: 20000,
    location: "Branch 2 safe",
    daysBefore: 33,
  },
  {
    number: 25,
    loanNo: "LN-BR2-00012",
    owner: "LR-0012310",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Chest freezer",
    serialNo: "CF-20931",
    valueCents: 40000,
    location: "Branch 2 store",
    daysBefore: 32,
  },
  {
    number: 26,
    loanNo: "LN-BR1-00011",
    owner: "LR-0012301",
    officerEmail: officer.BR1,
    type: "electronics",
    description: "Laptop",
    serialNo: "LT-5521-9",
    valueCents: 60000,
    location: "Main vault",
    daysBefore: 59,
  },
  {
    number: 27,
    loanNo: "LN-BR3-00005",
    owner: "LR-0012304",
    officerEmail: officer.BR3,
    type: "vehicle",
    description: "Motorbike",
    plateNo: "MB 3307",
    valueCents: 90000,
    location: "Branch 3 office",
    daysBefore: 23,
  },
  {
    number: 28,
    loanNo: "LN-BR2-00008",
    owner: "LR-0012305",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Flat-screen TV, 55 in",
    serialNo: "TV-55-80412",
    valueCents: 45000,
    location: "Branch 2 safe",
    daysBefore: 52,
  },
  {
    number: 29,
    loanNo: "LN-BR1-00013",
    owner: "Dolo & Sons Trading",
    officerEmail: officer.BR1,
    type: "land_document",
    description: "Land deed",
    documentNo: "D-2217",
    valueCents: 600000,
    location: "Main vault",
    daysBefore: 15,
  },
  {
    number: 30,
    loanNo: "LN-BR3-00004",
    owner: "LR-0012303",
    officerEmail: officer.BR3,
    type: "vehicle",
    description: "Toyota Corolla 2008",
    plateNo: "BRK 4821",
    valueCents: 420000,
    location: "Branch 3 yard",
    daysBefore: 69,
  },
  {
    number: 31,
    loanNo: "LN-BR2-00009",
    owner: "LR-0012345",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Honda EU22i generator",
    serialNo: "GA-1000231",
    valueCents: 140000,
    location: "Office desk",
    daysBefore: 38,
  },
  {
    number: 32,
    loanNo: "LN-BR2-00007",
    owner: "LR-0012306",
    officerEmail: officer.BR2,
    type: "goods",
    description: "Rice, 40 bags",
    valueCents: 110000,
    location: "Branch 2 store",
    daysBefore: 31,
  },
  {
    number: 33,
    loanNo: "LN-BR2-00010",
    owner: "LR-0012311",
    officerEmail: officer.BR2,
    type: "electronics",
    description: "Sewing machine",
    serialNo: "SM-7712",
    valueCents: 70000,
    location: "Branch 2 safe",
    daysBefore: 1,
  },
  {
    number: 34,
    loanNo: "LN-BR1-00014",
    owner: "LR-0012312",
    officerEmail: officer.BR1,
    type: "land_document",
    description: "Land deed",
    documentNo: "D-4410",
    valueCents: 550000,
    location: "Main vault",
    daysBefore: 1,
  },
];

interface DemoLoan {
  loanNo: string;
  customer: string;
  officerEmail: string;
  principalCents: number;
  daysBefore: number;
  purpose: string;
  pendingOnly?: boolean;
  guarantors?: Array<Record<string, string>>;
}

// docs/DEMO_DATA.md "Loans", in number order (the global loan counter, B-02).
const DEMO_LOANS: readonly DemoLoan[] = [
  {
    loanNo: "LN-BR2-00002",
    customer: "LR-0012345",
    officerEmail: officer.BR2,
    principalCents: 30000,
    daysBefore: 94,
    purpose: "Market stock",
  },
  {
    loanNo: "LN-BR2-00003",
    customer: "LR-0012309",
    officerEmail: officer.BR2,
    principalCents: 12500,
    daysBefore: 33,
    purpose: "Food stall supplies",
  },
  {
    loanNo: "LN-BR3-00004",
    customer: "LR-0012303",
    officerEmail: officer.BR3,
    principalCents: 150000,
    daysBefore: 69,
    purpose: "Taxi repairs",
  },
  {
    loanNo: "LN-BR3-00005",
    customer: "LR-0012304",
    officerEmail: officer.BR3,
    principalCents: 40000,
    daysBefore: 23,
    purpose: "Shop stock",
  },
  {
    loanNo: "LN-BR2-00006",
    customer: "LR-0012307",
    officerEmail: officer.BR2,
    principalCents: 50000,
    daysBefore: 30,
    purpose: "Fabric",
  },
  {
    loanNo: "LN-BR2-00007",
    customer: "LR-0012306",
    officerEmail: officer.BR2,
    principalCents: 60000,
    daysBefore: 31,
    purpose: "Shop stock",
  },
  {
    loanNo: "LN-BR2-00008",
    customer: "LR-0012305",
    officerEmail: officer.BR2,
    principalCents: 50000,
    daysBefore: 52,
    purpose: "Salon equipment",
  },
  {
    loanNo: "LN-BR2-00009",
    customer: "LR-0012345",
    officerEmail: officer.BR2,
    principalCents: 100000,
    daysBefore: 38,
    purpose: "Market stock",
    guarantors: [{ full_name: "Joseph Kollie", phone: "0770 555 014", relationship: "Brother" }],
  },
  {
    loanNo: "LN-BR2-00010",
    customer: "LR-0012311",
    officerEmail: officer.BR2,
    principalCents: 50000,
    daysBefore: 1,
    purpose: "Sewing work",
  },
  {
    loanNo: "LN-BR1-00011",
    customer: "LR-0012301",
    officerEmail: officer.BR1,
    principalCents: 70000,
    daysBefore: 59,
    purpose: "Tailoring materials",
  },
  {
    loanNo: "LN-BR2-00012",
    customer: "LR-0012310",
    officerEmail: officer.BR2,
    principalCents: 25000,
    daysBefore: 32,
    purpose: "Spare parts",
  },
  {
    loanNo: "LN-BR1-00013",
    customer: "Dolo & Sons Trading",
    officerEmail: officer.BR1,
    principalCents: 180000,
    daysBefore: 15,
    purpose: "Wholesale stock",
  },
  {
    loanNo: "LN-BR1-00014",
    customer: "LR-0012312",
    officerEmail: officer.BR1,
    principalCents: 250000,
    daysBefore: 1,
    purpose: "Farm inputs",
    pendingOnly: true,
  },
];

interface DemoPayment {
  receiptNo: number;
  loanNo: string;
  amountCents: number;
  daysBefore: number;
  time: string;
  field?: boolean;
}

// docs/DEMO_DATA.md "Payments", in receipt order (Branch 2 series; B-10: the receiver's branch).
// The earlier receipts are numbered below 000120 "in any order"; dates follow each loan's story.
// Mariama Kollie's $500 payment (RCT-BR2-000123) is not seeded: it is the demo e2e script.
const DEMO_PAYMENTS: readonly DemoPayment[] = [
  { receiptNo: 116, loanNo: "LN-BR2-00002", amountCents: 36000, daysBefore: 64, time: "11:15" },
  { receiptNo: 117, loanNo: "LN-BR1-00011", amountCents: 84000, daysBefore: 28, time: "10:40" },
  { receiptNo: 118, loanNo: "LN-BR2-00012", amountCents: 10000, daysBefore: 15, time: "14:05" },
  { receiptNo: 119, loanNo: "LN-BR2-00006", amountCents: 25000, daysBefore: 10, time: "09:50" },
  { receiptNo: 120, loanNo: "LN-BR2-00006", amountCents: 35000, daysBefore: 1, time: "08:45", field: true },
  { receiptNo: 121, loanNo: "LN-BR2-00012", amountCents: 20000, daysBefore: 1, time: "09:20" },
  { receiptNo: 122, loanNo: "LN-BR2-00003", amountCents: 15000, daysBefore: 1, time: "15:10" },
];

// DEMO_DATA "Collateral": items returned to their owners after their loans closed (Grace Flomo
// hands them over; the owner collects). COL-000022 (Musu Freeman) stays "ready to return".
const DEMO_RELEASES: ReadonlyArray<{ number: number; daysBefore: number; time: string; witness: string }> = [
  { number: 19, daysBefore: 64, time: "11:30", witness: "Mariama Kollie" },
  { number: 26, daysBefore: 23, time: "10:15", witness: "Prince Karmo" },
  { number: 25, daysBefore: 1, time: "09:40", witness: "Alieu Sesay" },
  { number: 24, daysBefore: 1, time: "15:30", witness: "Comfort Weah" },
];

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

  // 4. Customers (M2), created by their loan officers through create_customer at their
  //    registration time, so Mariama Kollie is CU-000008 (DEMO_DATA). Skipped when already present.
  const officerClients = new Map<string, SupabaseClient<Database>>();
  const signedIn = async (email: string) => {
    const cached = officerClients.get(email);
    if (cached !== undefined) return cached;
    const account = accounts.find((candidate) => candidate.email === email);
    if (account === undefined) throw new Error(`No demo account ${email}`);
    const officer = createClient<Database>(API_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await officer.auth.signInWithPassword({ email, password: account.password });
    if (error !== null) throw error;
    officerClients.set(email, officer);
    return officer;
  };
  const existingCustomers = new Set(
    ownerQuery<{ id_number: string | null; business_name: string | null }>(
      "select id_number, business_name from public.customers",
    ).flatMap((row) => [row.id_number, row.business_name].filter((value): value is string => value !== null)),
  );
  const [{ count: customerCount } = { count: 0 }] = ownerQuery<{ count: number }>(
    "select count(*)::int as count from public.customers",
  );
  if (customerCount > 0 && !existingCustomers.has(MARIAMA_ID)) {
    console.warn(
      "Customers already exist: demo customer codes will not match DEMO_DATA (use a fresh database).",
    );
  }
  for (const customer of DEMO_CUSTOMERS) {
    const key = customer.fields.id_number ?? customer.fields.business_name ?? "";
    if (existingCustomers.has(key)) continue;
    await rpc(client, "update_setting", {
      p_key: "clock.override_at",
      p_value: { at: `${addDays(anchor, -customer.registeredDaysBefore)}T10:00:00Z`, frozen: true },
    });
    await rpc(await signedIn(customer.officerEmail), "create_customer", {
      p_customer: { type: customer.type, ...customer.fields },
    });
  }

  // 4b. Loans (M3): opening capital, collateral and the DEMO_DATA loans, each created, approved and
  //     paid out at its story date through the RPCs (the business clock moves to each date).
  const at = async (daysBefore: number, time = "10:00") =>
    rpc(client, "update_setting", {
      p_key: "clock.override_at",
      p_value: { at: `${addDays(anchor, -daysBefore)}T${time}:00Z`, frozen: true },
    });
  const customerIds = new Map(
    ownerQuery<{ id_number: string | null; business_name: string | null; id: string }>(
      "select id, id_number, business_name from public.customers",
    ).flatMap((row) => [
      ...(row.id_number === null ? [] : [[row.id_number, row.id] as const]),
      ...(row.business_name === null ? [] : [[row.business_name, row.id] as const]),
    ]),
  );
  const existingLoans = new Set(
    ownerQuery<{ loan_no: string }>("select loan_no from public.loans").map((row) => row.loan_no),
  );
  if (existingLoans.size === 0) {
    const accountant = await signedIn("peter.zayzay@msi-demo.test");
    const manager = await signedIn("rebecca.wolo@msi-demo.test");
    const cashier = await signedIn("grace.flomo@msi-demo.test");
    const [{ id: productId } = { id: "" }] = ownerQuery<{ id: string }>(
      "select id from public.loan_products where name = 'Standard 1-month'",
    );
    const decide = async (type: string, match: string) => {
      const [request] = ownerQuery<{ id: string }>(
        `select id from public.approval_requests where type = ${sqlText(type)} and status = 'pending'
           and (payload ->> 'memo' = ${sqlText(match)} or payload ->> 'loan_no' = ${sqlText(match)})`,
      );
      if (request === undefined) throw new Error(`No pending ${type} request for ${match}`);
      await rpc(manager, "decide_approval", { p_id: request.id, p_decision: "approve", p_note: null });
    };

    // Opening capital before the first loan (amounts reconciled with the day close, see DEMO_CAPITAL).
    await at(DEMO_CAPITAL_DAYS_BEFORE, "08:30");
    for (const [account, cents] of DEMO_CAPITAL) {
      const memo = `Opening capital ${account}`;
      await rpc(accountant, "request_capital_in", {
        p_request: {
          entry_date: addDays(anchor, -DEMO_CAPITAL_DAYS_BEFORE),
          account,
          amount_cents: cents,
          memo,
        },
      });
      await at(DEMO_CAPITAL_DAYS_BEFORE, "09:00");
      await decide("capital_in", memo);
    }

    // Collateral in COL order; numbers below and between were paper records (B-02).
    const collateralIds = new Map<string, string>();
    for (const item of DEMO_COLLATERAL) {
      const [{ last_value: current } = { last_value: 0 }] = ownerQuery<{ last_value: number }>(
        "select last_value from public.document_sequences where kind = 'collateral'",
      );
      if (current < item.number - 1) {
        await rpc(client, "set_sequence_start", {
          p_kind: "collateral",
          p_branch_id: null,
          p_last_value: item.number - 1,
        });
      }
      await at(item.daysBefore, "09:30");
      const owner = customerIds.get(item.owner);
      if (owner === undefined) throw new Error(`No demo customer ${item.owner}`);
      const id = await rpc(await signedIn(item.officerEmail), "register_collateral", {
        p_item: {
          owner_customer_id: owner,
          type: item.type,
          description: item.description,
          serial_no: item.serialNo ?? null,
          plate_no: item.plateNo ?? null,
          document_no: item.documentNo ?? null,
          estimated_value_cents: item.valueCents,
          location_note: item.location,
        },
      });
      collateralIds.set(item.loanNo, String(id));
    }

    // The history is written loan by loan, then day by day, so payouts run ahead of the receipts
    // dated before them; the drawer check is paused while back-filling and restored below.
    const [{ value: checkFunds } = { value: true }] = ownerQuery<{ value: boolean }>(
      "select value as value from public.settings where key = 'disbursement.check_funds'",
    );
    await rpc(client, "update_setting", { p_key: "disbursement.check_funds", p_value: false });
    // Loans in number order. LN-00001 was a paper loan before the system.
    await rpc(client, "set_sequence_start", { p_kind: "loan", p_branch_id: null, p_last_value: 1 });
    for (const loan of DEMO_LOANS) {
      const officerClient = await signedIn(loan.officerEmail);
      const customerId = customerIds.get(loan.customer);
      if (customerId === undefined) throw new Error(`No demo customer ${loan.customer}`);
      await at(loan.daysBefore, "09:00");
      const loanId = String(
        await rpc(officerClient, "create_loan_draft", {
          p_loan: {
            customer_id: customerId,
            product_id: productId,
            principal_cents: loan.principalCents,
            term_months: 1,
            purpose: loan.purpose,
            guarantors: loan.guarantors ?? [],
          },
        }),
      );
      const itemId = collateralIds.get(loan.loanNo);
      if (itemId !== undefined)
        await rpc(officerClient, "link_collateral", { p_loan_id: loanId, p_collateral_id: itemId });
      await rpc(officerClient, "submit_loan", { p_loan_id: loanId });
      if (loan.pendingOnly === true) continue;
      await at(loan.daysBefore, "11:00");
      await decide("loan_approval", loan.loanNo);
      await at(loan.daysBefore, "14:00");
      await rpc(cashier, "disburse_loan", { p_loan_id: loanId, p_method: "cash" });
    }
    await rpc(client, "update_setting", { p_key: "disbursement.check_funds", p_value: checkFunds });
  }

  // 4c. The days from the first payout to A, in order (M4, M5). Each day starts with the nightly
  //     job at 01:00 (SPEC 5.5: overdue marking, penalties, recovery flags, run as the scheduler
  //     would, with no user), then that day's payments: Grace Flomo at the counter, Emmanuel Tarpeh
  //     in the field (cash not yet handed over). Loans paid in full close (SPEC 5.3). Days the job
  //     already ran are skipped, and payments are posted only on a database without any.
  const [{ count: paymentCount } = { count: 0 }] = ownerQuery<{ count: number }>(
    "select count(*)::int as count from public.payments",
  );
  const ranOn = new Set(
    ownerQuery<{ run_date: string }>("select distinct run_date::text from public.accrual_runs").map(
      (row) => row.run_date,
    ),
  );
  const cashier = await signedIn("grace.flomo@msi-demo.test");
  const fieldOfficer = await signedIn("emmanuel.tarpeh@msi-demo.test");
  const loanIds = new Map(
    ownerQuery<{ id: string; loan_no: string }>("select id, loan_no from public.loans").map((row) => [
      row.loan_no,
      row.id,
    ]),
  );
  if (paymentCount === 0) {
    const branch2 = branchIds.get("BR2") ?? null;
    await rpc(client, "set_sequence_start", { p_kind: "receipt", p_branch_id: branch2, p_last_value: 115 });
  }
  const firstDay = Math.max(
    ...DEMO_LOANS.filter((loan) => loan.pendingOnly !== true).map((loan) => loan.daysBefore),
  );
  for (let daysBefore = firstDay; daysBefore >= 0; daysBefore -= 1) {
    if (!ranOn.has(addDays(anchor, -daysBefore))) {
      await at(daysBefore, "01:00");
      ownerQuery("select public.scheduled_daily_accruals()::text as run");
    }
    if (paymentCount > 0) continue;
    for (const payment of DEMO_PAYMENTS.filter((item) => item.daysBefore === daysBefore)) {
      const loanId = loanIds.get(payment.loanNo);
      if (loanId === undefined) throw new Error(`No demo loan ${payment.loanNo}`);
      await at(payment.daysBefore, payment.time);
      const args = {
        p_loan_id: loanId,
        p_amount_cents: payment.amountCents,
        p_method: "cash",
        p_reference: "",
        p_received_on: addDays(anchor, -payment.daysBefore),
        p_idempotency_key: `demo-receipt-${payment.receiptNo}`,
      };
      const receipt = (await rpc(
        payment.field === true ? fieldOfficer : cashier,
        payment.field === true ? "record_field_payment" : "receive_payment",
        args,
      )) as { receipt_no?: string };
      const expected = `RCT-BR2-${String(payment.receiptNo).padStart(6, "0")}`;
      if (receipt.receipt_no !== expected) {
        throw new Error(`Expected ${expected} for ${payment.loanNo}, got ${receipt.receipt_no ?? "nothing"}`);
      }
    }
  }

  // 4c (continued). The day-by-day story of collateral and recovery (M6), after the timeline above
  //     has posted that day's payments: COL-000031's custody log on A−38 (valued by Rebecca Wolo,
  //     moved to the safe by Grace Flomo), releases after loans closed, and Mohammed Sheriff's case
  //     RC-000001 (opened A−8 by Rebecca Wolo on the first eligible day; demand notice A−5).
  const items = new Map(
    ownerQuery<{ id: string; code: string; status: string }>(
      "select id, code, status from public.collaterals",
    ).map((row) => [row.code, row]),
  );
  const code = (number: number) => `COL-${String(number).padStart(6, "0")}`;
  const generator = items.get(code(31));
  const [{ count: valuedCount } = { count: 0 }] = ownerQuery<{ count: number }>(
    `select count(*)::int as count from public.collateral_events where event_type = 'valued'
       and collateral_id = ${sqlText(generator?.id ?? "00000000-0000-0000-0000-000000000000")}`,
  );
  if (generator !== undefined && valuedCount === 0) {
    const manager = await signedIn("rebecca.wolo@msi-demo.test");
    await at(38, "14:25");
    await rpc(manager, "log_collateral_event", {
      p_collateral_id: generator.id,
      p_event: { event_type: "valued", value_cents: 140000, note: "Estimated value $1,400.00" },
    });
    await at(38, "15:00");
    await rpc(cashier, "log_collateral_event", {
      p_collateral_id: generator.id,
      p_event: { event_type: "moved", to_location: "Branch 2 safe, shelf B2" },
    });
  }
  for (const release of DEMO_RELEASES) {
    const item = items.get(code(release.number));
    if (item === undefined || item.status !== "held") continue;
    await at(release.daysBefore, release.time);
    await rpc(cashier, "release_collateral", {
      p_collateral_id: item.id,
      p_note: "Returned to the owner after the loan was repaid",
      p_witness_name: release.witness,
    });
  }
  const mohammedLoan = loanIds.get("LN-BR3-00004");
  const [{ count: caseCount } = { count: 0 }] = ownerQuery<{ count: number }>(
    "select count(*)::int as count from public.recovery_cases",
  );
  if (mohammedLoan !== undefined && caseCount === 0) {
    const manager = await signedIn("rebecca.wolo@msi-demo.test");
    // The job flagged the loan on A−8 (due + 30); recovery opens that day, the notice three days later.
    await at(8, "10:30");
    const caseId = String(
      await rpc(manager, "open_recovery_case", {
        p_loan_id: mohammedLoan,
        p_note: "No payment and no reply since the due date; first eligible day",
      }),
    );
    await at(5, "11:00");
    await rpc(manager, "advance_recovery_stage", {
      p_case_id: caseId,
      p_stage: "notice_sent",
      p_note: "Demand notice delivered by hand by David Kerkula",
    });
  }

  // 4d. Waiting on A: Emmanuel Tarpeh asked on A−1 at 16:40 to extend Joseph B. Gbessay's loan by a
  //     month (DEMO_DATA "Approvals waiting"; adds $120.00).
  const josephLoan = loanIds.get("LN-BR2-00007");
  const [{ count: extensionCount } = { count: 0 }] = ownerQuery<{ count: number }>(
    "select count(*)::int as count from public.approval_requests where type = 'loan_extension'",
  );
  if (josephLoan !== undefined && extensionCount === 0) {
    await at(1, "16:40");
    await rpc(fieldOfficer, "request_extension", {
      p_loan_id: josephLoan,
      p_extra_months: 1,
      p_reason: "Shop stock delayed at port",
    });
  }

  // 4e. Expenses (M8; DEMO_DATA "Day close" and "Approvals waiting"): office supplies of $45.00 paid
  //     from the Branch 2 drawer on A−1 at 13:40 (EXP-BR2-000031, below the $100 limit, posted at
  //     once), and Peter Zayzay's court filing fee of $240.00 for LN-BR3-00004 on A at 08:15, above
  //     the limit, waiting for a manager.
  const [{ count: expenseCount } = { count: 0 }] = ownerQuery<{ count: number }>(
    "select count(*)::int as count from public.expenses",
  );
  if (expenseCount === 0) {
    const accountant = await signedIn("peter.zayzay@msi-demo.test");
    await rpc(client, "set_sequence_start", {
      p_kind: "expense",
      p_branch_id: branchIds.get("BR2") ?? null,
      p_last_value: 30,
    });
    await at(1, "13:40");
    await rpc(accountant, "create_expense", {
      p_expense: {
        account: "5900",
        amount_cents: 4500,
        expense_date: addDays(anchor, -1),
        description: "Office supplies",
        branch_id: branchIds.get("BR2") ?? null,
        paid_now: true,
        paid_from: "1010-BR2",
      },
    });
    await at(0, "08:15");
    await rpc(accountant, "create_expense", {
      p_expense: {
        account: "5040",
        amount_cents: 24000,
        expense_date: anchor,
        description: "Court filing fee, LN-BR3-00004",
        branch_id: branchIds.get("BR3") ?? null,
        paid_now: true,
        paid_from: "1010-BR3",
      },
    });
    await accountant.auth.signOut();
  }

  // 5. Waiting on A (DEMO_DATA "Approvals waiting"): Emmanuel Tarpeh asks to change Mariama
  //    Kollie's phone at about 07:10.
  const [mariama] = ownerQuery<{ id: string; phone: string; pending: number }>(
    `select c.id, c.phone, (select count(*)::int from public.approval_requests r
                             where r.entity_id = c.id and r.status = 'pending') as pending
       from public.customers c where c.id_number = ${sqlText(MARIAMA_ID)}`,
  );
  if (mariama !== undefined && mariama.pending === 0 && mariama.phone === "0770 555 010") {
    await rpc(client, "update_setting", {
      p_key: "clock.override_at",
      p_value: { at: `${anchor}T07:10:00Z`, frozen: true },
    });
    await rpc(await signedIn("emmanuel.tarpeh@msi-demo.test"), "request_customer_edit", {
      p_customer_id: mariama.id,
      p_patch: { phone: "0770 555 011" },
      p_reason: null,
    });
  }
  for (const officer of officerClients.values()) await officer.auth.signOut();

  // 6. Leave the clock at the morning of A (DEMO_DATA "Seeded state"), or at real time.
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
