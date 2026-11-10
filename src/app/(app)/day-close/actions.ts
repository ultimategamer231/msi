"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* Day close (SPEC 5.10; FR-23): the database computes the expected cash and checks every rule. */
export type DayCloseResult = { ok: true } | { ok: false; code: ErrorCode };
const uuid = /^[0-9a-f-]{36}$/;

export async function submitDayClose(
  branchId: string,
  date: string,
  counted: string,
  note: string,
): Promise<DayCloseResult> {
  const staff = await getCurrentStaff();
  if (staff.status !== "ok" || staff.staff.role !== "cashier") return { ok: false, code: "FORBIDDEN" };
  const cents = parseDollarsToCents(counted);
  if (
    !uuid.test(branchId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    cents === null ||
    cents < 0n ||
    note.length > 500
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_day_close", {
    p_branch_id: branchId,
    p_date: date,
    // Whole cents as a JSON number; exact for any realistic amount (far below 2^53 cents).
    p_counted_cents: Number(cents),
    p_note: note.trim(),
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code}`, userId: staff.staff.id, where: "dayClose.submit" });
    return { ok: false, code };
  }
  revalidatePath("/day-close");
  return { ok: true };
}

export async function reopenDayClose(closeId: string, reason: string): Promise<DayCloseResult> {
  const staff = await getCurrentStaff();
  if (staff.status !== "ok" || !["manager", "ceo"].includes(staff.staff.role))
    return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(closeId) || reason.trim() === "" || reason.length > 500)
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_day_close", { p_id: closeId, p_reason: reason.trim() });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code}`, userId: staff.staff.id, where: "dayClose.reopen" });
    return { ok: false, code };
  }
  revalidatePath("/day-close");
  return { ok: true };
}
