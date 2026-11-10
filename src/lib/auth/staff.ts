import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { logServerError } from "@/lib/log";
import { canAccess, type Role, type RouteKey } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Data access layer for the signed-in staff member (Next.js authentication guide: verify the
 * session close to the data, in every page and action). The profile is read through RLS, so an
 * inactive or unknown user gets no row and is treated as signed out.
 */
export interface Staff {
  id: string;
  fullName: string;
  role: Role;
  branch: { id: string; code: string; name: string } | null;
}

export type StaffResult =
  { status: "signed-out" } | { status: "inactive"; userId: string } | { status: "ok"; staff: Staff };

export const getCurrentStaff = cache(async (): Promise<StaffResult> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (userId === undefined) return { status: "signed-out" };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, active, branch:branches!profiles_branch_id_fkey(id, code, name)")
    .eq("id", userId)
    .maybeSingle();

  // A failed query is an outage, not a fact about the user: surface it through the error page
  // instead of treating the user as inactive.
  if (error !== null) {
    logServerError({ code: `PROFILE_READ_${error.code}`, userId, where: "auth.getCurrentStaff" });
    throw new Error("Could not read the staff profile");
  }

  if (profile === null || !profile.active) return { status: "inactive", userId };

  return {
    status: "ok",
    staff: {
      id: profile.id,
      fullName: profile.full_name,
      role: profile.role,
      branch: profile.branch,
    },
  };
});

/**
 * Call at the top of every protected page with the page's route pattern. Redirects signed-out
 * users to /login, inactive users through sign-out, and roles without access to /dashboard.
 */
export async function requirePageAccess(route: RouteKey): Promise<Staff> {
  const result = await getCurrentStaff();
  if (result.status === "signed-out") redirect("/login");
  if (result.status === "inactive") redirect("/auth/sign-out?notice=inactive");
  if (!canAccess(result.staff.role, route)) redirect("/dashboard?notice=forbidden");
  return result.staff;
}
