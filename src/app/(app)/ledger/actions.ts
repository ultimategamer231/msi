"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  capitalInSchema,
  manualJournalSchema,
  openingBalanceSchema,
  type CapitalInValues,
  type ManualJournalValues,
} from "./schemas";

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

/*
 * Capital in (recipe R10, R-14): requested by the accountant or admin like a manual journal and
 * posted (Dr cash/bank/MoMo, Cr 3000) only when a manager approves it.
 */
export async function requestCapitalIn(values: CapitalInValues): Promise<ManualJournalResult> {
  const staff = await getCurrentStaff();
  if (staff.status !== "ok" || !["accountant", "admin"].includes(staff.staff.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const parsed = capitalInSchema.safeParse(values);
  const cents = parsed.success ? parseDollarsToCents(parsed.data.amount) : null;
  if (!parsed.success || cents === null) return { ok: false, code: "INVALID_INPUT" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_capital_in", {
    p_request: {
      entry_date: parsed.data.entryDate,
      account: parsed.data.account,
      // Whole cents as a JSON number; exact for any realistic amount (far below 2^53 cents).
      amount_cents: Number(cents),
      memo: parsed.data.memo,
      reference: parsed.data.reference,
    },
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code}`, userId: staff.staff.id, where: "ledger.requestCapitalIn" });
    return { ok: false, code };
  }
  revalidatePath("/ledger");
  return { ok: true };
}

/*
 * Opening balances (FR-27, R12): admin or accountant, before go-live only. Posted at once; the
 * RPC checks the date, the accounts and puts the difference on 3900.
 */
export async function importOpeningBalance(values: ManualJournalValues): Promise<ManualJournalResult> {
  const staff = await getCurrentStaff();
  if (staff.status !== "ok" || !["accountant", "admin"].includes(staff.staff.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const parsed = openingBalanceSchema.safeParse(values);
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
  const { error } = await supabase.rpc("import_opening_balance", {
    p_entry: { entry_date: parsed.data.entryDate, memo: parsed.data.memo, lines },
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({
        code: `RPC_${error.code}`,
        userId: staff.staff.id,
        where: "ledger.importOpeningBalance",
      });
    return { ok: false, code };
  }
  revalidatePath("/ledger");
  return { ok: true };
}
