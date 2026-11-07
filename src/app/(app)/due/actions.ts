"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RunResult =
  | { ok: true; overdueMarked: number; penaltiesPosted: number; recoveryFlagged: number }
  | { ok: false; code: ErrorCode };

/* run_daily_accruals (SPEC 5.5, D-11): the manual run for today, by a manager or the admin. */
export async function runDailyJob(): Promise<RunResult> {
  const result = await getCurrentStaff();
  if (result.status !== "ok" || !["manager", "admin"].includes(result.staff.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("run_daily_accruals", {});
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code ?? ""}`, userId: result.staff.id, where: "due.runDailyJob" });
    return { ok: false, code };
  }
  const run = data as { overdue_marked: number; penalties_posted: number; recovery_flagged: number };
  revalidatePath("/due");
  revalidatePath("/loans");
  revalidatePath("/field");
  return {
    ok: true,
    overdueMarked: run.overdue_marked,
    penaltiesPosted: run.penalties_posted,
    recoveryFlagged: run.recovery_flagged,
  };
}
