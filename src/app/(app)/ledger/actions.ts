"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { manualJournalSchema, type ManualJournalValues } from "./schemas";

export type ManualJournalResult = { ok: true } | { ok: false; code: ErrorCode };

/*
 * Manual journal request (SPEC 4: accountant, admin; R11). The RPC checks the role again, validates
 * the journal under the real posting rules and stores a pending request for a manager.
 */
export async function requestManualJournal(values: ManualJournalValues): Promise<ManualJournalResult> {
  const staff = await getCurrentStaff();
  if (staff.status !== "ok" || !["accountant", "admin"].includes(staff.staff.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const parsed = manualJournalSchema.safeParse(values);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };

  const lines = parsed.data.lines.map((line) => {
    const debit = line.debit === "" ? 0n : (parseDollarsToCents(line.debit) ?? 0n);
    const credit = line.credit === "" ? 0n : (parseDollarsToCents(line.credit) ?? 0n);
    // Whole cents as JSON numbers; exact for any realistic amount (far below 2^53 cents).
    return debit > 0n
      ? { account: line.account, debit_cents: Number(debit) }
      : { account: line.account, credit_cents: Number(credit) };
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_manual_journal", {
    p_request: {
      entry_date: parsed.data.entryDate,
      memo: parsed.data.memo,
      branch_id: parsed.data.branchId === "" ? null : parsed.data.branchId,
      lines,
    },
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({
        code: `RPC_${error.code}`,
        userId: staff.staff.id,
        where: "ledger.requestManualJournal",
      });
    return { ok: false, code };
  }
  revalidatePath("/ledger");
  return { ok: true };
}
