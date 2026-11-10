"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DecisionResult = { ok: true } | { ok: false; code: ErrorCode };

/*
 * decide_approval (SPEC 8; FR-28). The database checks the role, the request level, that the
 * decider is not the requester (SELF_APPROVAL) and that a rejection has a note, then applies it.
 */
export async function decideApproval(
  requestId: string,
  decision: "approve" | "reject",
  note: string,
): Promise<DecisionResult> {
  const staff = await getCurrentStaff();
  if (staff.status !== "ok" || (staff.staff.role !== "manager" && staff.staff.role !== "ceo")) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const trimmed = note.trim();
  if (
    !/^[0-9a-f-]{36}$/.test(requestId) ||
    trimmed.length > 500 ||
    (decision === "reject" && trimmed === "")
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decide_approval", {
    p_id: requestId,
    p_decision: decision,
    p_note: trimmed,
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({
        code: `RPC_${error.code}`,
        userId: staff.staff.id,
        where: "approvals.decideApproval",
      });
    return { ok: false, code };
  }
  // The approvals count sits in the shell on every page.
  revalidatePath("/", "layout");
  return { ok: true };
}
