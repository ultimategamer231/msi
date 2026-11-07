"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff, type Staff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import type { Role } from "@/lib/permissions";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { paymentSchema, type PaymentValues } from "./schemas";

const RECEIVE_ROLES: readonly Role[] = ["cashier", "manager"];
const VOID_ROLES: readonly Role[] = ["cashier", "manager", "accountant"];
const uuid = /^[0-9a-f-]{36}$/;

async function staffIn(roles: readonly Role[]): Promise<Staff | null> {
  const result = await getCurrentStaff();
  return result.status === "ok" && roles.includes(result.staff.role) ? result.staff : null;
}

export type PreviewResult =
  | {
      ok: true;
      owed: { penalty: string; interest: string; principal: string; total: string };
      allocation: { penalty: string; interest: string; principal: string };
      afterCents: string;
      overpayment: boolean;
    }
  | { ok: false; code: ErrorCode };

/* preview_payment: the split take_payment would post (SPEC 5.2); no allocation rule in TypeScript. */
export async function previewPayment(loanId: string, amount: string): Promise<PreviewResult> {
  const staff = await staffIn(RECEIVE_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const cents = amount.trim() === "" ? 0n : parseDollarsToCents(amount);
  if (!uuid.test(loanId) || cents === null) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_payment", {
    p_loan_id: loanId,
    p_amount_cents: Number(cents),
  });
  if (error !== null) return { ok: false, code: errorCodeFrom(error) };
  const preview = data as {
    owed: Record<"penalty" | "interest" | "principal" | "total", number>;
    allocation: Record<"penalty" | "interest" | "principal", number>;
    after_cents: number;
    overpayment: boolean;
  };
  return {
    ok: true,
    owed: {
      penalty: String(preview.owed.penalty),
      interest: String(preview.owed.interest),
      principal: String(preview.owed.principal),
      total: String(preview.owed.total),
    },
    allocation: {
      penalty: String(preview.allocation.penalty),
      interest: String(preview.allocation.interest),
      principal: String(preview.allocation.principal),
    },
    afterCents: String(preview.after_cents),
    overpayment: preview.overpayment,
  };
}

export type ReceiveResult = { ok: true; paymentId: string } | { ok: false; code: ErrorCode };

/* receive_payment (SPEC 5.4.1, R2): today's date; the request key makes a retry safe (T-12). */
export async function receivePayment(values: PaymentValues): Promise<ReceiveResult> {
  const staff = await staffIn(RECEIVE_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = paymentSchema.safeParse(values);
  const cents = parsed.success ? parseDollarsToCents(parsed.data.amount) : null;
  if (!parsed.success || cents === null) return { ok: false, code: "INVALID_INPUT" };
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  // A cashier or manager can only use today's business date (SPEC 5.4.1); the database checks it.
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) return { ok: false, code: "UNKNOWN" };
  const { data: receipt, error } = await supabase.rpc("receive_payment", {
    p_loan_id: data.loanId,
    p_amount_cents: Number(cents),
    p_method: data.method,
    p_reference: data.method === "cash" ? "" : data.reference,
    p_received_on: today,
    p_idempotency_key: data.requestKey,
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code ?? ""}`, userId: staff.id, where: "payments.receivePayment" });
    return { ok: false, code };
  }
  const paymentId = String((receipt as { payment_id: string }).payment_id);
  revalidatePath(`/loans/${data.loanId}`);
  revalidatePath("/loans");
  revalidatePath("/payments");
  return { ok: true, paymentId };
}

export type VoidResult = { ok: true } | { ok: false; code: ErrorCode };

/* request_void_payment (SPEC 5.4.9): a reason is required; another manager or the CEO approves. */
export async function requestVoid(paymentId: string, reason: string): Promise<VoidResult> {
  const staff = await staffIn(VOID_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const trimmed = reason.trim().slice(0, 300);
  if (!uuid.test(paymentId) || trimmed === "") return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_void_payment", {
    p_payment_id: paymentId,
    p_reason: trimmed,
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code ?? ""}`, userId: staff.id, where: "payments.requestVoid" });
    return { ok: false, code };
  }
  revalidatePath("/payments");
  revalidatePath(`/receipts/${paymentId}`);
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
  return { ok: true };
}
