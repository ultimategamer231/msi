import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabasePublicEnv } from "@/lib/env";

/*
 * Service-role client for Supabase Auth administration (SPEC 8: admin_create_user and password
 * resets; callers check that the signed-in user is an admin first) and for the sign-in lockout
 * (login_guard, SPEC 11), the only function granted to it. It bypasses RLS but has no table
 * privileges (M0.2).
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
