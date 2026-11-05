import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Ends the session and returns to the sign-in page.
 * POST: the "Sign out" button. GET: used only by the route guard to sign out a deactivated user
 * (notice=inactive); signing someone out is the only effect, so a forged GET can do no harm.
 */
const NOTICES = new Set(["signed-out", "inactive", "expired"]);

async function signOut(request: NextRequest, notice: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const safeNotice = NOTICES.has(notice) ? notice : "signed-out";
  return NextResponse.redirect(new URL(`/login?notice=${safeNotice}`, request.url), { status: 303 });
}

export async function POST(request: NextRequest) {
  return signOut(request, "signed-out");
}

export async function GET(request: NextRequest) {
  return signOut(request, request.nextUrl.searchParams.get("notice") ?? "signed-out");
}
