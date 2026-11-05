import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { supabasePublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, acting as the signed-in
 * user (anon key + the user's session cookie, so RLS applies). Server Components cannot write
 * cookies; the proxy refreshes the session before they run, so a failed write there is harmless.
 *
 * `connection()` marks the render as request-time: the auth client reads the clock (token expiry),
 * which Cache Components does not allow while prerendering.
 */
export async function createSupabaseServerClient() {
  await connection();
  const cookieStore = await cookies();
  const { url, anonKey } = supabasePublicEnv();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy has already
          // refreshed the session for this request.
        }
      },
    },
  });
}
