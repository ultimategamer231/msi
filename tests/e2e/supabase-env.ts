import { runSupabase } from "../../scripts/supabase-cli";

/*
 * Local Supabase connection details for e2e runs. Uses the environment when set (CI exports them),
 * otherwise asks the local Supabase CLI. Never used against a hosted project.
 */
export interface LocalSupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

let cached: LocalSupabaseEnv | undefined;

export function localSupabaseEnv(): LocalSupabaseEnv {
  if (cached !== undefined) return cached;
  const fromEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.url && fromEnv.anonKey && fromEnv.serviceRoleKey) {
    cached = { url: fromEnv.url, anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
    return cached;
  }
  const status = JSON.parse(
    runSupabase(["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as Record<string, string | undefined>;
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = status;
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error("Local Supabase is not running. Start it with `pnpm db:start`.");
  }
  cached = { url: API_URL, anonKey: ANON_KEY, serviceRoleKey: SERVICE_ROLE_KEY };
  return cached;
}
