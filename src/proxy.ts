import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isSessionExpired } from "@/lib/auth/session";
import { supabasePublicEnv } from "@/lib/env";
import { isPublicPath } from "@/lib/permissions";
import type { Database } from "@/types/database";

/*
 * Runs before every page request (Next.js 16 "proxy", formerly middleware).
 *  - Refreshes the Supabase session cookie.
 *  - Optimistic checks only (Next.js authentication guide): signed-out visitors go to /login with
 *    the page they wanted in `next`; sessions older than 12 hours (SPEC 11) are ended.
 * Role checks happen in each page (requirePageAccess) and again in Postgres; this file never
 * decides authorisation on its own.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims() verifies the access token (refreshing it when needed). Do not put code between
  // creating the client and this call: the refreshed cookies must reach the response.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const { pathname, search } = request.nextUrl;

  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (claims !== undefined && isSessionExpired(claims, Math.floor(Date.now() / 1000))) {
    await supabase.auth.signOut({ scope: "local" });
    return redirectTo("/login?notice=expired");
  }

  if (claims === undefined && !isPublicPath(pathname)) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return redirectTo(`/login${next}`);
  }

  if (claims !== undefined && pathname === "/login") {
    return redirectTo("/dashboard");
  }

  return response;
}

export const config = {
  // Everything except Next.js assets, static files and the auth route that signs users out.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|auth/sign-out|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
