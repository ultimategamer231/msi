import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { localSupabaseEnv } from "./supabase-env";

/* Service-role client for test assertions on the LOCAL stack only (e.g. reading audit rows). */
export function serviceClient() {
  const env = localSupabaseEnv();
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function latestAudit(action: string, entityId: string) {
  const { data, error } = await serviceClient()
    .from("audit_log")
    .select("action, entity_id, actor_role, before, after")
    .eq("action", action)
    .eq("entity_id", entityId)
    .order("chain_no", { ascending: false })
    .limit(5);
  if (error !== null) throw error;
  return data;
}

/** Runs one SQL statement as the LOCAL database owner (test setup only, e.g. posting a journal). */
export function ownerSql(sql: string): void {
  execFileSync("pnpm", ["-s", "supabase", "db", "query", sql], { stdio: ["ignore", "ignore", "inherit"] });
}
