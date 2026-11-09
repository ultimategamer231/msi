"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff, type Staff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { expenseSchema, payeeSchema, type ExpenseValues, type PayeeValues } from "./schemas";

/*
 * Expenses and payees (SPEC 4: manager, accountant; FR-22). The RPCs check the role, the limit
 * routing and the accounts again; nothing is posted here.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; code: ErrorCode };
type RpcError = { code?: string; message?: string };

async function moneyStaff(): Promise<Staff | null> {
  const result = await getCurrentStaff();
  return result.status === "ok" && ["manager", "accountant"].includes(result.staff.role)
    ? result.staff
    : null;
}

function failure(error: RpcError, staff: Staff, where: string): { ok: false; code: ErrorCode } {
  const code = errorCodeFrom(error);
  if (code === "UNKNOWN") logServerError({ code: `RPC_${error.code ?? ""}`, userId: staff.id, where });
  return { ok: false, code };
}

export async function createExpense(
  values: ExpenseValues,
  receipt: { storagePath: string; fileName: string } | null,
): Promise<ActionResult<{ number: string; status: string }>> {
  const staff = await moneyStaff();
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = expenseSchema.safeParse(values);
  const cents = parsed.success ? parseDollarsToCents(parsed.data.amount) : null;
  if (!parsed.success || cents === null) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_expense", {
    p_expense: {
      account: parsed.data.account,
      // Whole cents as a JSON number; exact for any realistic amount (far below 2^53 cents).
      amount_cents: Number(cents),
      expense_date: parsed.data.expenseDate,
      description: parsed.data.description,
      branch_id: parsed.data.branchId === "" ? null : parsed.data.branchId,
      payee_id: parsed.data.payeeId === "" ? null : parsed.data.payeeId,
      paid_now: parsed.data.paidNow,
      paid_from: parsed.data.paidNow ? parsed.data.paidFrom : null,
      receipt: receipt === null ? null : { storage_path: receipt.storagePath, file_name: receipt.fileName },
    },
  });
  if (error !== null) return failure(error, staff, "expenses.create");
  revalidatePath("/expenses");
  const result = (data ?? {}) as { expense_no?: string; status?: string };
  return { ok: true, data: { number: result.expense_no ?? "", status: result.status ?? "" } };
}

export async function settleExpense(id: string, account: string): Promise<ActionResult> {
  const staff = await moneyStaff();
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9]{4}(-[A-Z][A-Z0-9]{1,9})?$/.test(account)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("settle_expense", { p_id: id, p_account: account });
  if (error !== null) return failure(error, staff, "expenses.settle");
  revalidatePath("/expenses");
  revalidatePath("/payees");
  return { ok: true, data: undefined };
}

export async function savePayee(id: string | null, values: PayeeValues): Promise<ActionResult> {
  const staff = await moneyStaff();
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = payeeSchema.safeParse(values);
  if (!parsed.success || (id !== null && !/^[0-9a-f-]{36}$/.test(id)))
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_payee", {
    p_id: id as string,
    p_payee: { ...parsed.data },
  });
  if (error !== null) return failure(error, staff, "payees.save");
  revalidatePath("/payees");
  revalidatePath("/expenses");
  return { ok: true, data: undefined };
}
