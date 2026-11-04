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

/** A client signed in as a test user, for setting up data through the same RPCs the app uses. */
export async function userClient(user: { email: string; password: string }) {
  const env = localSupabaseEnv();
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error !== null) throw error;
  return client;
}

/** Creates a customer as the given user through create_customer; returns its id and code. */
export async function createTestCustomer(
  user: { email: string; password: string },
  fields: Record<string, string>,
): Promise<{ id: string; code: string }> {
  const client = await userClient(user);
  const { data: code, error } = await client.rpc("create_customer", {
    p_customer: { type: "individual", ...fields },
  });
  if (error !== null) throw error;
  const { data, error: readError } = await client.from("customers").select("id").eq("code", code).single();
  if (readError !== null) throw readError;
  return { id: data.id, code };
}
