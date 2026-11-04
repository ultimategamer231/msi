/*
 * Environment variables (SPEC 3.4). Read lazily so a missing value fails with a clear message at
 * the point of use, not at import time (the build must not need a database).
 * NEXT_PUBLIC_* values are referenced literally so Next.js can inline them for the browser.
 */
export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

export function supabasePublicEnv(): SupabasePublicEnv {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}
