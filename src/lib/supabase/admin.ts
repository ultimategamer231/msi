import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabasePublicEnv } from "@/lib/env";

/*
 * Service-role client for Supabase Auth administration only (SPEC 8: admin_create_user and
 * password resets). It bypasses RLS, so callers must check that the signed-in user is an admin
 * first. It cannot write application tables (no table privileges, M0.2).
 */
export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key === undefined || key.trim() === "") {
    throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY. See .env.example.");
  }
  return createClient(supabasePublicEnv().url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
