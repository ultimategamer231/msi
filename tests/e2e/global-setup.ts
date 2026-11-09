import { runSupabase } from "../../scripts/supabase-cli";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { CREDENTIALS_FILE, FIXTURES, type FixtureUser } from "./fixtures";
import { localSupabaseEnv } from "./supabase-env";

/*
 * Creates (or refreshes) the e2e staff accounts in the LOCAL Supabase stack:
 *  - auth users through the Auth admin API with a new random password each run;
 *  - staff profiles through `supabase db query`, which runs as the local database owner.
 * Credentials are written to tests/e2e/.auth/users.json (git-ignored) for the tests to read.
 */
function sqlText(value: string | null): string {
  return value === null ? "null" : `'${value.replace(/'/g, "''")}'`;
}

export default async function globalSetup(): Promise<void> {
  const env = localSupabaseEnv();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existing = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error !== null) throw error;
    for (const user of data.users) if (user.email !== undefined) existing.set(user.email, user.id);
    if (data.users.length < 200) break;
  }

  const users: Array<FixtureUser & { id: string }> = [];
  for (const fixture of FIXTURES) {
    const password = randomBytes(18).toString("base64url");
    let id = existing.get(fixture.email);
    if (id === undefined) {
      const { data, error } = await admin.auth.admin.createUser({
        email: fixture.email,
        password,
        email_confirm: true,
      });
      if (error !== null) throw error;
      id = data.user.id;
    } else {
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error !== null) throw error;
    }
    users.push({ ...fixture, password, id });
  }

  // One statement: `supabase db query` runs a single prepared statement.
  const rows = users.map(
    (user) => `(${sqlText(user.id)}::uuid, ${sqlText(user.fullName)}, ${sqlText(user.role)}::public.app_role,
      (select id from public.branches where code = ${sqlText(user.branchCode)}), ${user.active})`,
  );
  const upsert = `insert into public.profiles (id, full_name, role, branch_id, active) values ${rows.join(",\n")}
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
      branch_id = excluded.branch_id, active = excluded.active`;
  runSupabase(["db", "query", upsert], { stdio: ["ignore", "ignore", "inherit"] });

  mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify(
      users.map(({ id: _id, ...user }) => user),
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
