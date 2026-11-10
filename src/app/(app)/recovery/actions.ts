"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff, type Staff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import type { Role } from "@/lib/permissions";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RECOVERY_ROLES: readonly Role[] = ["manager", "ceo"];
const WRITE_OFF_ROLES: readonly Role[] = ["manager", "accountant"];
const STAGES = ["notice_sent", "court_filed", "judgment", "disposal"] as const;
const METHODS = ["cash", "mobile_money", "bank", "cheque"] as const;
const uuid = /^[0-9a-f-]{36}$/;

async function staffIn(roles: readonly Role[]): Promise<Staff | null> {
  const result = await getCurrentStaff();
  return result.status === "ok" && roles.includes(result.staff.role) ? result.staff : null;
}

export type ActionResult = { ok: true; id?: string } | { ok: false; code: ErrorCode };

function failure(error: { code?: string; message?: string }, staff: Staff, where: string): ActionResult {
  const code = errorCodeFrom(error);
  if (code === "UNKNOWN") logServerError({ code: `RPC_${error.code ?? ""}`, userId: staff.id, where });
  return { ok: false, code };
}

function refresh(caseId?: string, loanId?: string) {
  revalidatePath("/recovery");
  if (caseId !== undefined) revalidatePath(`/recovery/${caseId}`);
  if (loanId !== undefined) revalidatePath(`/loans/${loanId}`);
  revalidatePath("/collateral");
  revalidatePath("/due");
}

/* open_recovery_case (SPEC 5.7): an overdue loan flagged eligible by the daily job. */
export async function openCase(loanId: string, note: string): Promise<ActionResult> {
  const staff = await staffIn(RECOVERY_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(loanId)) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("open_recovery_case", {
    p_loan_id: loanId,
    p_note: note.trim().slice(0, 500),
  });
  if (error !== null) return failure(error, staff, "recovery.openCase");
  refresh(String(data), loanId);
  return { ok: true, id: String(data) };
}

export interface StepFile {
  storagePath: string;
  fileName: string;
}

/* advance_recovery_stage: notice sent, court filed, judgment or disposal, with an optional document. */
export async function recordStep(
  caseId: string,
  stage: string,
  note: string,
  courtRef: string,
  file: StepFile | null,
): Promise<ActionResult> {
  const staff = await staffIn(RECOVERY_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(caseId) || !(STAGES as readonly string[]).includes(stage) || note.trim() === "")
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("advance_recovery_stage", {
    p_case_id: caseId,
    p_stage: stage,
    p_note: note.trim().slice(0, 500),
    p_court_ref: courtRef.trim().slice(0, 100),
    p_files:
      file === null
        ? []
        : [
            {
              kind: stage === "notice_sent" ? "notice" : "court_document",
              storage_path: file.storagePath,
              file_name: file.fileName,
            },
          ],
  });
  if (error !== null) return failure(error, staff, "recovery.recordStep");
  refresh(caseId);
  return { ok: true };
}

export type SalePreview =
  | {
      ok: true;
      owed: { penalty: string; interest: string; principal: string; total: string };
      allocation: { penalty: string; interest: string; principal: string };
      surplusCents: string;
      shortfallCents: string;
    }
  | { ok: false; code: ErrorCode };

/* preview_collateral_sale: the same allocation the sale will post (no formula in TypeScript). */
export async function previewSale(caseId: string, amount: string): Promise<SalePreview> {
  const staff = await staffIn(RECOVERY_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const cents = amount.trim() === "" ? 0n : parseDollarsToCents(amount);
  if (!uuid.test(caseId) || cents === null) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_collateral_sale", {
    p_case_id: caseId,
    p_amount_cents: Number(cents),
  });
  if (error !== null) return { ok: false, code: errorCodeFrom(error) };
  const preview = data as {
    owed: Record<"penalty" | "interest" | "principal" | "total", number>;
    allocation: Record<"penalty" | "interest" | "principal", number>;
    surplus_cents: number;
    shortfall_cents: number;
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
    surplusCents: String(preview.surplus_cents),
    shortfallCents: String(preview.shortfall_cents),
  };
}

/* record_collateral_sale (R7): today, proceeds by method; surplus to 2100. */
export async function recordSale(
  caseId: string,
  loanId: string,
  values: { collateralId: string; amount: string; buyer: string; method: string; courtRef: string },
): Promise<ActionResult> {
  const staff = await staffIn(RECOVERY_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const cents = parseDollarsToCents(values.amount);
  if (
    !uuid.test(caseId) ||
    !uuid.test(values.collateralId) ||
    cents === null ||
    cents <= 0n ||
    values.buyer.trim() === "" ||
    !(METHODS as readonly string[]).includes(values.method)
  )
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_collateral_sale", {
    p_case_id: caseId,
    p_collateral_id: values.collateralId,
    p_sale_amount_cents: Number(cents),
    p_buyer_name: values.buyer.trim().slice(0, 120),
    p_method: values.method,
    p_court_ref: values.courtRef.trim().slice(0, 100),
  });
  if (error !== null) return failure(error, staff, "recovery.recordSale");
  refresh(caseId, loanId);
  return { ok: true };
}

/* pay_surplus (R7b). */
export async function paySurplus(
  caseId: string,
  loanId: string,
  amount: string,
  method: string,
): Promise<ActionResult> {
  const staff = await staffIn(RECOVERY_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const cents = parseDollarsToCents(amount);
  if (!uuid.test(loanId) || cents === null || cents <= 0n || !(METHODS as readonly string[]).includes(method))
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("pay_surplus", {
    p_loan_id: loanId,
    p_amount_cents: Number(cents),
    p_method: method,
  });
  if (error !== null) return failure(error, staff, "recovery.paySurplus");
  refresh(caseId, loanId);
  return { ok: true };
}

/* request_write_off (SPEC 5.8): manager or accountant; the CEO decides with the board reference. */
export async function requestWriteOff(loanId: string, reason: string): Promise<ActionResult> {
  const staff = await staffIn(WRITE_OFF_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(loanId) || reason.trim() === "") return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_write_off", {
    p_loan_id: loanId,
    p_reason: reason.trim().slice(0, 500),
  });
  if (error !== null) return failure(error, staff, "recovery.requestWriteOff");
  refresh(undefined, loanId);
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
  return { ok: true };
}
