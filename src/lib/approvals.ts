import "server-only";

import { cache } from "react";

import type { Staff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Pending requests the signed-in user can decide (SPEC 9: "approvals bell, count of pending items
 * you can decide"): managers decide manager-level requests, the CEO decides every level; nobody
 * decides their own (SELF_APPROVAL). Other roles decide nothing, so their count is 0.
 */
export const approvalsWaiting = cache(async (staff: Staff): Promise<number> => {
  if (staff.role !== "manager" && staff.role !== "ceo") return 0;
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("approval_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .neq("requested_by", staff.id);
  if (staff.role === "manager") query = query.eq("required_role", "manager");
  const { count, error } = await query;
  if (error !== null) throw new Error("Could not count approvals");
  return count ?? 0;
});
